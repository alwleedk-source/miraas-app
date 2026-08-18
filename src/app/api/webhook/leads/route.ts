import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEndpoints, leads, pipelineStages, leadSources, activityLog, webhookCoordinators, users, notifications } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { sendWelcomeMessage } from "@/lib/whatsapp";
import { validateAndNormalizePhone } from "@/lib/utils";
import { webhookEntrySchema } from "@/lib/schemas";
import { logger } from "@/lib/logger";
import { verifySecret, hashSecret, secretPrefix } from "@/lib/secret-hash";
import { timingSafeEqual } from "crypto";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 60; // 60 request/minute per webhook
const RATE_WINDOW_MS = 60_000;
const MAX_ENTRIES = 100;
const MAX_BODY_BYTES = 200_000; // 200KB — أي payload أكبر = غير مشروع

/**
 * POST /api/webhook/leads
 */
export async function POST(request: NextRequest) {
  try {
    // 1. حد حجم الـ body
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    }

    // 2. validate secret — hash-based + legacy plaintext fallback
    const secret = request.headers.get("x-webhook-secret");
    if (!secret || secret.length < 16) {
      return NextResponse.json({ error: "مفتاح الويب هوك مطلوب" }, { status: 401 });
    }

    const prefix = secretPrefix(secret);
    const candidates = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.isActive, true));

    // نرشّح أولاً بالـ prefix لتقليل scrypt compares
    const prefixMatches = candidates.filter((c) => {
      if (c.secretPrefix) return c.secretPrefix === prefix;
      // legacy rows بدون prefix — نجرب plaintext match كـ fallback
      return !!c.secretKey;
    });

    let webhook: (typeof candidates)[number] | undefined;
    for (const c of prefixMatches) {
      if (c.secretHash) {
        if (await verifySecret(secret, c.secretHash)) {
          webhook = c;
          break;
        }
      } else if (c.secretKey) {
        // legacy plaintext — مقارنة timing-safe (كانت === تسرّب قناة توقيت)
        const a = Buffer.from(c.secretKey);
        const b = Buffer.from(secret);
        if (a.length === b.length && timingSafeEqual(a, b)) {
          webhook = c;
          break;
        }
      }
    }

    if (!webhook) {
      return NextResponse.json({ error: "مفتاح ويب هوك غير صالح" }, { status: 403 });
    }

    // ترقية legacy فعلية — التعليق القديم كان يَعِد بها دون تنفيذ:
    // عند أول نجاح plaintext نحسب hash+prefix ونمسح السر المخزَّن بوضوح.
    if (!webhook.secretHash && webhook.secretKey) {
      try {
        const secretHash = await hashSecret(secret);
        await db
          .update(webhookEndpoints)
          .set({ secretHash, secretPrefix: prefix, secretKey: null })
          .where(eq(webhookEndpoints.id, webhook.id));
      } catch (err) {
        // فشل الترقية لا يوقف الاستقبال — تُعاد المحاولة مع الطلب القادم
        logger.error("legacy webhook secret upgrade failed", err, {
          webhookId: webhook.id,
        });
      }
    }

    // 3. rate limit على الـ webhook ID — Postgres-backed (يعمل عبر replicas)
    const rl = await rateLimit(`webhook:${webhook.id}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "تم تجاوز الحد المسموح" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)),
          },
        },
      );
    }

    await db
      .update(webhookEndpoints)
      .set({ lastReceivedAt: new Date() })
      .where(eq(webhookEndpoints.id, webhook.id));

    // 4. parse body — لا نثق بـ Content-Length وحده (قد يغيب مع chunked أو يكذب).
    //    نقرأ النص ونفرض الحدّ على البايتات الفعلية قبل JSON.parse.
    const rawText = await request.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    }
    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: "JSON غير صالح" }, { status: 400 });
    }
    const rawEntries = Array.isArray(body) ? body : [body];

    if (rawEntries.length === 0) {
      return NextResponse.json({ error: "لا توجد بيانات" }, { status: 400 });
    }
    if (rawEntries.length > MAX_ENTRIES) {
      return NextResponse.json(
        { error: `الحد الأقصى ${MAX_ENTRIES} عميل` },
        { status: 400 },
      );
    }

    // 5. Zod validation — كل entry يجب أن يمر
    const validated: { name: string; phone: string; email?: string | null; campaign?: string }[] = [];
    let rejectedCount = 0;
    for (const raw of rawEntries) {
      const parsed = webhookEntrySchema.safeParse(raw);
      if (parsed.success) {
        validated.push(parsed.data);
      } else {
        rejectedCount++;
      }
    }

    if (validated.length === 0) {
      return NextResponse.json(
        { error: "كل الإدخالات غير صالحة", rejected: rejectedCount },
        { status: 400 },
      );
    }

    // 6. normalize phones + فلتر الأرقام غير الصالحة
    const normalized = validated
      .map((e) => {
        const r = validateAndNormalizePhone(e.phone);
        return {
          name: e.name,
          email: e.email ?? null,
          campaign: e.campaign?.trim() || null,
          phone: r.valid && r.phone ? r.phone : null,
        };
      })
      .filter((e) => !!e.phone) as {
      name: string;
      email: string | null;
      campaign: string | null;
      phone: string;
    }[];

    const invalidPhones = validated.length - normalized.length;
    if (normalized.length === 0) {
      return NextResponse.json({
        success: true,
        created: 0,
        invalidPhones,
        rejected: rejectedCount,
        message: "لا أرقام صالحة للإدخال",
      });
    }

    // 6ب. dedupe داخل الدفعة نفسها بالرقم المُطبَّع (أول ظهور يفوز) — بدونها يتكرّر
    // نفس الرقم في payload واحد ويمرّ فحص المكررات ضد الـ DB (لا يرى دفعة اليوم بعد).
    const deduped = new Map<string, (typeof normalized)[number]>();
    for (const e of normalized) {
      if (!deduped.has(e.phone)) deduped.set(e.phone, e);
    }
    const batch = [...deduped.values()];
    const batchDuplicates = normalized.length - batch.length;

    // 7. جميع الاستعلامات والكتابات في transaction واحد
    const result = await db.transaction(async (tx) => {
      // المرحلة الافتراضية
      const [defaultStage] = await tx
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .where(
          and(
            eq(pipelineStages.tenantId, webhook.tenantId),
            eq(pipelineStages.isDefault, true),
          ),
        )
        .limit(1);

      // اقفل صفّ الـ webhook (FOR UPDATE) مبكراً — قبل فحص المكررات وقبل قراءة
      // مؤشّر round-robin. القفل يُسلسِل الطلبات المتزامنة على نفس الـ webhook:
      // الطلب الثاني ينتظر commit الأول فيرى leads المُدرَجة حديثاً عند فحص
      // المكررات (كان الفحص يسبق القفل = سباق إدراج مزدوج لنفس الرقم)، ويقرأ
      // المؤشّر المُحدَّث (كان الطلبان يقرآن نفس القيمة فيُسنِدان لنفس المنسق).
      const [lockedWebhook] = await tx
        .select({ lastAssignedToUserId: webhookEndpoints.lastAssignedToUserId })
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, webhook.id))
        .for("update");
      const lastAssigned = lockedWebhook?.lastAssignedToUserId ?? webhook.lastAssignedToUserId;

      // حل أسماء الحملات الفريدة إلى source IDs دفعة واحدة
      const uniqueCampaigns = [
        ...new Set(batch.map((e) => e.campaign).filter((c): c is string => !!c)),
      ];
      const campaignToSourceId = new Map<string, string>();
      if (uniqueCampaigns.length > 0) {
        const existingSources = await tx
          .select({ id: leadSources.id, name: leadSources.name })
          .from(leadSources)
          .where(
            and(
              eq(leadSources.tenantId, webhook.tenantId),
              inArray(leadSources.name, uniqueCampaigns),
            ),
          );
        for (const s of existingSources) {
          campaignToSourceId.set(s.name, s.id);
        }
        const toCreate = uniqueCampaigns.filter((c) => !campaignToSourceId.has(c));
        if (toCreate.length > 0) {
          const created = await tx
            .insert(leadSources)
            .values(
              toCreate.map((name) => ({
                tenantId: webhook.tenantId,
                name,
                platform: "Google Sheets",
              })),
            )
            .returning({ id: leadSources.id, name: leadSources.name });
          for (const c of created) {
            campaignToSourceId.set(c.name, c.id);
          }
        }
      }

      // فحص المكررات + DNC + المؤرشفين دفعة واحدة — داخل المعاملة وبعد القفل
      // (انظر أعلاه) حتى يرى الطلب المتزامن الثاني ما أدرجه الأول.
      const phones = batch.map((e) => e.phone);
      const existing = await tx
        .select({
          id: leads.id,
          phone: leads.phone,
          isDeleted: leads.isDeleted,
          canRecontact: leads.canRecontact,
          archivedAt: leads.archivedAt,
        })
        .from(leads)
        .where(and(eq(leads.tenantId, webhook.tenantId), inArray(leads.phone, phones)));

      // نشط (لا محذوف/مؤرشف/DNC) = مكرر حقيقي — يُتخطّى
      const activeSet = new Set(
        existing
          .filter((e) => !e.isDeleted && !e.archivedAt && e.canRecontact)
          .map((e) => e.phone!),
      );
      const deletedSet = new Set(
        existing.filter((e) => e.isDeleted).map((e) => e.phone!),
      );
      // DNC = العميل سبق وطلب عدم التواصل — احترم القرار، لا تُنشئ lead جديد
      const dncSet = new Set(
        existing.filter((e) => !e.canRecontact).map((e) => e.phone!),
      );
      // مؤرشف (لا محذوف ولا DNC) = عميل عاد بنفسه — نعيد تفعيله بدل تخطّيه صامتاً
      // (سابقاً كان المؤرشف يُحسب "مكرراً" فيختفي ولا يعلم به أحد)
      const archivedMap = new Map(
        existing
          .filter((e) => !e.isDeleted && e.canRecontact && e.archivedAt)
          .map((e) => [e.phone!, e.id] as const),
      );

      // تصفية: جديد فعلاً + ليس DNC/محذوف/نشط-مكرر/مؤرشف
      const toInsert = batch.filter(
        (e) =>
          !activeSet.has(e.phone) &&
          !deletedSet.has(e.phone) &&
          !dncSet.has(e.phone) &&
          !archivedMap.has(e.phone),
      );
      // العائدون من الأرشيف — فقط إن لم يوجد صف نشط/محذوف/DNC لنفس الرقم
      // (صف مكرر قديم في الـ DB قد يجعل الرقم في مجموعتين — النشط يكسب)
      const toReactivate = batch.filter(
        (e) =>
          archivedMap.has(e.phone) &&
          !activeSet.has(e.phone) &&
          !deletedSet.has(e.phone) &&
          !dncSet.has(e.phone),
      );

      // ===== Auto-assign: round-robin بين منسقي الحملة =====
      // 1 منسق → كل leads له
      // 2+ → نوّع: نبدأ بعد آخر منسق أُسنِد له lead سابق
      // 0 → no auto-assign (السلوك الحالي قبل هذه الميزة)
      // فلترة على المنسقين النشطين فقط — منسق معطَّل (deactivated) كان يستمرّ
      // في استلام leads جديدة عبر round-robin رغم أنه لا يستطيع الدخول، فتضيع
      // الـ leads (لا يراها بقية المنسقين). نربط بـ users ونشترط isActive.
      const coords = await tx
        .select({ userId: webhookCoordinators.userId })
        .from(webhookCoordinators)
        .innerJoin(users, eq(users.id, webhookCoordinators.userId))
        .where(
          and(
            eq(webhookCoordinators.webhookId, webhook.id),
            eq(users.isActive, true),
          ),
        )
        .orderBy(webhookCoordinators.createdAt);
      const coordIds = coords.map((c) => c.userId);

      // round-robin: حدّد نقطة البداية (المؤشّر lastAssigned مقروء تحت قفل FOR UPDATE أعلاه)
      let nextIdx = 0;
      if (coordIds.length > 1 && lastAssigned) {
        const lastIdx = coordIds.indexOf(lastAssigned);
        nextIdx = lastIdx >= 0 ? (lastIdx + 1) % coordIds.length : 0;
      }

      const createdLeads: { id: string; name: string; phone: string; assignedTo: string | null }[] = [];
      let lastAssignedInBatch: string | null = null;
      if (toInsert.length > 0) {
        const inserted = await tx
          .insert(leads)
          .values(
            toInsert.map((e) => {
              // أسنِد لـ coordinator التالي في الدورة (لو فيه coordinators)
              const assignedTo = coordIds.length > 0 ? coordIds[nextIdx] : null;
              if (assignedTo) {
                lastAssignedInBatch = assignedTo;
                nextIdx = (nextIdx + 1) % coordIds.length;
              }
              return {
                tenantId: webhook.tenantId,
                name: e.name,
                phone: e.phone,
                email: e.email,
                priority: "MEDIUM" as const,
                stageId: defaultStage?.id ?? null,
                sourceId: e.campaign ? campaignToSourceId.get(e.campaign) ?? null : null,
                webhookEndpointId: webhook.id,
                assignedTo,
              };
            }),
          )
          .returning({ id: leads.id, name: leads.name, phone: leads.phone, assignedTo: leads.assignedTo });

        for (const l of inserted) {
          if (l.phone) createdLeads.push({ id: l.id, name: l.name, phone: l.phone, assignedTo: l.assignedTo });
        }

        // حدّث round-robin pointer لـ next request
        if (lastAssignedInBatch) {
          await tx
            .update(webhookEndpoints)
            .set({ lastAssignedToUserId: lastAssignedInBatch })
            .where(eq(webhookEndpoints.id, webhook.id));
        }

        // أشعِر كل منسق بعميله الجديد (NEW_LEAD) — كان الإسناد round-robin صامتاً
        // فلا ينتبه المنسق للعميل إلا إذا فتح القائمة صدفة.
        const notifValues = createdLeads
          .filter((l) => l.assignedTo)
          .map((l) => ({
            tenantId: webhook.tenantId,
            userId: l.assignedTo!,
            type: "NEW_LEAD" as const,
            title: `عميل جديد: ${l.name}`,
            message: `أُسند إليك عميل جديد "${l.name}" عبر ${webhook.label ?? "الويب هوك"}`,
          }));
        if (notifValues.length > 0) {
          await tx.insert(notifications).values(notifValues);
        }
      }

      // إعادة تفعيل المؤرشفين العائدين عبر الـ webhook: مسح حقول الأرشيف
      // + عودة للمرحلة الافتراضية (نفس دلالات unarchiveLead في archive.ts)
      const reactivated: { id: string; phone: string }[] = [];
      if (toReactivate.length > 0) {
        const reactivateUpdate: Record<string, unknown> = {
          archivedAt: null,
          archiveReason: null,
          archiveNote: null,
          reactivateAt: null,
          updatedAt: new Date(),
        };
        if (defaultStage) reactivateUpdate.stageId = defaultStage.id;
        await tx
          .update(leads)
          .set(reactivateUpdate)
          .where(
            and(
              eq(leads.tenantId, webhook.tenantId),
              inArray(leads.id, toReactivate.map((e) => archivedMap.get(e.phone)!)),
            ),
          );
        for (const e of toReactivate) {
          reactivated.push({ id: archivedMap.get(e.phone)!, phone: e.phone });
        }
      }

      // activity log مجمّع (إدخال واحد) — لو أُنشئ أو أُعيد تفعيل أي lead
      if (createdLeads.length > 0 || reactivated.length > 0) {
        await tx.insert(activityLog).values({
          tenantId: webhook.tenantId,
          action: "WEBHOOK_RECEIVED",
          entityType: "lead",
          details: {
            source: "webhook",
            webhookId: webhook.id,
            created: createdLeads.length,
            reactivated: reactivated.length,
            reactivatedLeadIds: reactivated.map((r) => r.id),
            skippedDuplicate: activeSet.size,
            skippedDeleted: deletedSet.size,
            batchDuplicates,
            invalidPhones,
            rejected: rejectedCount,
          },
        });
      }

      return {
        createdLeads,
        reactivated,
        skippedDuplicate: activeSet.size,
        skippedDeleted: deletedSet.size,
        skippedDnc: dncSet.size,
      };
    });

    // 8. ترحيب تلقائي — فقط لدفعة من عميل واحد حقيقي
    // يمرّر welcomeTemplateName من الـ webhook (override) — null = استخدم الافتراضي
    // ويمرّر assignedTo (المنسق المُختار round-robin) لاستخدام رقمه إن كان له credentials
    const isSingleRealTime = rawEntries.length === 1 && result.createdLeads.length === 1;
    const shouldSendWelcome = webhook.sendWelcome && isSingleRealTime;
    if (shouldSendWelcome && result.createdLeads[0]) {
      const l = result.createdLeads[0];
      sendWelcomeMessage(
        webhook.tenantId,
        l.phone,
        l.name,
        l.id,
        webhook.welcomeTemplateName, // قالب مخصّص لهذه الحملة، إن وُجد
        l.assignedTo, // ← رقم المنسق المُسنَد له. سياسة الترحيب "لا fallback": لو لم يربط
        //    المنسق رقمه، لا يُرسَل ترحيب (تجنّب inbox مختلط) — خلافاً للتذكيرات التي ترجع لرقم المنشأة.
      ).catch((err) => {
        logger.error("welcome message failed", err, {
          leadId: l.id,
          tenantId: webhook.tenantId,
        });
      });
    }

    return NextResponse.json({
      success: true,
      message: `تم إضافة ${result.createdLeads.length} عميل`,
      created: result.createdLeads.length,
      reactivated: result.reactivated.length, // مؤرشفون عادوا — أُعيد تفعيلهم تلقائياً
      skippedDuplicate: result.skippedDuplicate,
      skippedDeleted: result.skippedDeleted,
      skippedDnc: result.skippedDnc, // عملاء طلبوا عدم التواصل — احتُرم قرارهم
      batchDuplicates, // تكرار داخل الـ payload نفسه (أول ظهور فاز)
      invalidPhones,
      rejected: rejectedCount,
      total: rawEntries.length,
      leads: result.createdLeads.map((l) => ({ id: l.id, name: l.name })),
    });
  } catch (error) {
    logger.error("webhook processing failed", error);
    return NextResponse.json(
      { error: "حدث خطأ في معالجة الويب هوك" },
      { status: 500 },
    );
  }
}
