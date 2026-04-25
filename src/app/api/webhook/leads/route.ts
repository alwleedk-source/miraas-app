import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEndpoints, leads, pipelineStages, leadSources, activityLog, webhookCoordinators } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { sendWelcomeMessage } from "@/lib/whatsapp";
import { validateAndNormalizePhone } from "@/lib/utils";
import { webhookEntrySchema } from "@/lib/schemas";
import { logger } from "@/lib/logger";
import { verifySecret, secretPrefix } from "@/lib/secret-hash";
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
      } else if (c.secretKey && c.secretKey === secret) {
        // legacy plaintext — نقبله مؤقتاً + نرقّيه إلى hash
        webhook = c;
        break;
      }
    }

    if (!webhook) {
      return NextResponse.json({ error: "مفتاح ويب هوك غير صالح" }, { status: 403 });
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

    // 4. parse body
    const body = await request.json();
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

      // حل أسماء الحملات الفريدة إلى source IDs دفعة واحدة
      const uniqueCampaigns = [
        ...new Set(normalized.map((e) => e.campaign).filter((c): c is string => !!c)),
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

      // فحص المكررات + DNC دفعة واحدة
      const phones = normalized.map((e) => e.phone);
      const existing = await tx
        .select({
          phone: leads.phone,
          isDeleted: leads.isDeleted,
          canRecontact: leads.canRecontact,
        })
        .from(leads)
        .where(and(eq(leads.tenantId, webhook.tenantId), inArray(leads.phone, phones)));

      const activeSet = new Set(
        existing.filter((e) => !e.isDeleted).map((e) => e.phone!),
      );
      const deletedSet = new Set(
        existing.filter((e) => e.isDeleted).map((e) => e.phone!),
      );
      // DNC = العميل سبق وطلب عدم التواصل — احترم القرار، لا تُنشئ lead جديد
      const dncSet = new Set(
        existing.filter((e) => !e.canRecontact).map((e) => e.phone!),
      );

      // تصفية: جديد فعلاً + ليس DNC
      const toInsert = normalized.filter(
        (e) => !activeSet.has(e.phone) && !deletedSet.has(e.phone) && !dncSet.has(e.phone),
      );

      // ===== Auto-assign: round-robin بين منسقي الحملة =====
      // 1 منسق → كل leads له
      // 2+ → نوّع: نبدأ بعد آخر منسق أُسنِد له lead سابق
      // 0 → no auto-assign (السلوك الحالي قبل هذه الميزة)
      const coords = await tx
        .select({ userId: webhookCoordinators.userId })
        .from(webhookCoordinators)
        .where(eq(webhookCoordinators.webhookId, webhook.id))
        .orderBy(webhookCoordinators.createdAt);
      const coordIds = coords.map((c) => c.userId);

      // round-robin: حدّد نقطة البداية
      let nextIdx = 0;
      if (coordIds.length > 1 && webhook.lastAssignedToUserId) {
        const lastIdx = coordIds.indexOf(webhook.lastAssignedToUserId);
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

        // activity log مجمّع (إدخال واحد)
        await tx.insert(activityLog).values({
          tenantId: webhook.tenantId,
          action: "WEBHOOK_RECEIVED",
          entityType: "lead",
          details: {
            source: "webhook",
            webhookId: webhook.id,
            created: createdLeads.length,
            skippedDuplicate: activeSet.size,
            skippedDeleted: deletedSet.size,
            invalidPhones,
            rejected: rejectedCount,
          },
        });
      }

      return {
        createdLeads,
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
        l.assignedTo, // ← رقم المنسق المُسنَد له (fallback لـ tenant default إن لم يكن له creds)
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
      skippedDuplicate: result.skippedDuplicate,
      skippedDeleted: result.skippedDeleted,
      skippedDnc: result.skippedDnc, // عملاء طلبوا عدم التواصل — احتُرم قرارهم
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
