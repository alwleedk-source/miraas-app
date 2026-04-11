import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEndpoints, leads, pipelineStages, leadSources, activityLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sendWelcomeMessage } from "@/lib/whatsapp";
import { validateAndNormalizePhone } from "@/lib/utils";

// =============================================
// Rate Limiting
// =============================================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

const MAX_ENTRIES = 100;

/**
 * POST /api/webhook/leads
 */
export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: "تم تجاوز الحد المسموح" }, { status: 429 });
    }

    const secret = request.headers.get("x-webhook-secret");
    if (!secret) {
      return NextResponse.json({ error: "مفتاح الويب هوك مطلوب" }, { status: 401 });
    }

    const [webhook] = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.secretKey, secret), eq(webhookEndpoints.isActive, true)))
      .limit(1);

    if (!webhook) {
      return NextResponse.json({ error: "مفتاح ويب هوك غير صالح" }, { status: 403 });
    }

    await db
      .update(webhookEndpoints)
      .set({ lastReceivedAt: new Date() })
      .where(eq(webhookEndpoints.id, webhook.id));

    const body = await request.json();
    const entries = Array.isArray(body) ? body : [body];

    if (entries.length === 0) {
      return NextResponse.json({ error: "لا توجد بيانات" }, { status: 400 });
    }
    if (entries.length > MAX_ENTRIES) {
      return NextResponse.json({ error: `الحد الأقصى ${MAX_ENTRIES} عميل` }, { status: 400 });
    }

    // المرحلة الافتراضية
    const [defaultStage] = await db
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.tenantId, webhook.tenantId), eq(pipelineStages.isDefault, true)))
      .limit(1);

    // كاش الحملات (Fix #1: كل عميل يأخذ حملته)
    const sourceCache = new Map<string, string>();

    async function getOrCreateSource(campaignName: string): Promise<string> {
      const cached = sourceCache.get(campaignName);
      if (cached) return cached;

      const [existing] = await db
        .select({ id: leadSources.id })
        .from(leadSources)
        .where(and(eq(leadSources.tenantId, webhook.tenantId), eq(leadSources.name, campaignName)))
        .limit(1);

      if (existing) {
        sourceCache.set(campaignName, existing.id);
        return existing.id;
      }

      const [newSource] = await db
        .insert(leadSources)
        .values({ tenantId: webhook.tenantId, name: campaignName, platform: "Google Sheets" })
        .returning();

      sourceCache.set(campaignName, newSource.id);
      return newSource.id;
    }

    // إدخال العملاء
    let created = 0;
    let skippedDuplicate = 0;
    let skippedDeleted = 0;
    let invalidPhones = 0;
    const createdLeads: { id: string; name: string }[] = [];

    // 🧠 Smart Welcome Detection:
    // - عميل واحد = فورم حقيقي (onFormSubmit) → ترحيب ✅
    // - عدة عملاء = دفع جماعي (bulk sync) → بدون ترحيب ❌
    const isSingleRealTimeLead = entries.length === 1;
    const shouldSendWelcome = webhook.sendWelcome && isSingleRealTimeLead;

    for (const entry of entries) {
      if (!entry.name) continue;

      // 📱 التحقق من الرقم — يجب أن يكون موجوداً وصالحاً
      if (!entry.phone) continue; // ❌ لا نسحب بدون رقم

      const rawPhone = entry.phone.toString().trim();
      if (!rawPhone || rawPhone === "0" || rawPhone.length < 4) continue; // ❌ رقم غير حقيقي

      const phoneResult = validateAndNormalizePhone(rawPhone);
      let phone: string;

      if (phoneResult.valid && phoneResult.phone) {
        // ✅ رقم صالح بصيغة E.164 (مع مفتاح دولي)
        phone = phoneResult.phone;
      } else {
        // ⚠️ رقم غير مؤكد — نحفظه منظّفاً ليعدّله المستخدم يدوياً
        const cleaned = rawPhone
          .replace(/[٠-٩]/g, (d: string) => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString())
          .replace(/[۰-۹]/g, (d: string) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d).toString())
          .replace(/[^\d+]/g, "");
        if (!cleaned || cleaned.length < 4) continue; // ❌ رقم غير حقيقي
        phone = cleaned;
        invalidPhones++;
      }

      // فحص التكرار بالرقم
      const [existing] = await db
        .select({ id: leads.id, isDeleted: leads.isDeleted })
        .from(leads)
        .where(and(eq(leads.tenantId, webhook.tenantId), eq(leads.phone, phone)))
        .limit(1);

      if (existing && !existing.isDeleted) { skippedDuplicate++; continue; }
      if (existing && existing.isDeleted) { skippedDeleted++; continue; }

      // Fix #1: حملة لكل عميل
      let sourceId: string | null = null;
      const campaignName = entry.campaign?.toString().trim();
      if (campaignName) {
        sourceId = await getOrCreateSource(campaignName);
      }

      // تاريخ الانضمام — إذا أرسل الشيت تاريخاً أصلياً نستخدمه
      const joinedAt = entry.joinedAt ? new Date(entry.joinedAt) : new Date();
      const isValidDate = !isNaN(joinedAt.getTime());

      const [lead] = await db
        .insert(leads)
        .values({
          tenantId: webhook.tenantId,
          name: entry.name,
          phone: phone,
          email: entry.email || null,
          priority: "MEDIUM",
          stageId: defaultStage?.id || null,
          sourceId,
          createdAt: isValidDate ? joinedAt : new Date(),
        })
        .returning({ id: leads.id, name: leads.name });

      // تسجيل النشاط
      await db.insert(activityLog).values({
        tenantId: webhook.tenantId,
        action: "WEBHOOK_RECEIVED",
        entityType: "lead",
        entityId: lead.id,
        details: { source: "Google Sheets", leadName: entry.name, campaign: campaignName || null },
      });

      created++;
      createdLeads.push({ id: lead.id, name: lead.name });

      // إرسال ترحيب فقط للعملاء الجدد من فورم حقيقي
      if (shouldSendWelcome && phone) {
        sendWelcomeMessage(webhook.tenantId, phone, entry.name, lead.id).catch(() => {});
      }
    }

    // Fix #8: استجابة مفصّلة
    return NextResponse.json({
      success: true,
      message: `تم إضافة ${created} عميل` + (invalidPhones > 0 ? ` (${invalidPhones} رقم غير صالح)` : ""),
      created,
      skippedDuplicate,
      skippedDeleted,
      invalidPhones,
      total: entries.length,
      leads: createdLeads,
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "حدث خطأ في معالجة الويب هوك" }, { status: 500 });
  }
}
