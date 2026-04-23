import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, whatsappConfigs, activityLog } from "@/db/schema";
import { eq, and, gte, lte, isNotNull, sql } from "drizzle-orm";
import { decrypt } from "@/lib/encryption";
import { timingSafeEqual } from "crypto";
import { logger } from "@/lib/logger";
import { validateAndNormalizePhone } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================
// Cron: تذكير حجوزات عبر واتساب
// مبني على دراسات: التذكير المزدوج يقلل عدم الحضور 39%
//
// رابطين في cron-job.org:
// 8 مساءً → ?type=evening (تذكير بحجوزات الغد)
// 8 صباحاً → ?type=morning (تذكير بحجوزات اليوم)
// =============================================

// تنظيف القيمة من المسافات/quotes (Coolify قد يحفظها بـ wrappers)
// lazy: نتحقّق عند أول طلب، ليس عند تحميل الموديول (يكسر next build)
function getCronSecret(): string | null {
  const raw = process.env.CRON_SECRET
    ?.trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
  if (!raw || raw.length < 32) return null;
  return raw;
}
const RIYADH_TZ = "Asia/Riyadh";

/**
 * حساب بداية/نهاية يوم بتوقيت الرياض
 * Fix #1: لضمان عدم اختلاف التاريخ بين UTC والسيرفر
 */
type BookingForReminder = {
  id: string;
  name: string;
  phone: string | null;
  bookingDate: Date | null;
  bookingService: string | null;
};

type WhatsappConfigRow = {
  tenantId: string;
  apiKeyEncrypted: string | null;
  phoneNumber: string | null;
  reminderTemplateName: string | null;
  templateLanguage: string | null;
};

type SendOutcome = "sent" | "failed" | "retryable";

/** أرسل تذكير واحد — يُرجع "retryable" على 429/5xx ليعيد cron في المرة التالية */
async function sendReminder(args: {
  booking: BookingForReminder;
  config: WhatsappConfigRow;
  accessToken: string;
  type: "morning" | "evening";
}): Promise<SendOutcome> {
  const { booking, config, accessToken, type } = args;
  if (!booking.phone || !config.phoneNumber || !config.reminderTemplateName) return "failed";

  // تنسيق الرقم بـ libphonenumber — يضيف country code للأرقام المحلية ويرفض غير الصالحة
  const phoneCheck = validateAndNormalizePhone(booking.phone);
  if (!phoneCheck.valid || !phoneCheck.phone) {
    // رقم غير صالح — سجّل فشلاً واضحاً ولا تحاول إرساله
    await db.insert(activityLog).values({
      tenantId: config.tenantId,
      action: "WHATSAPP_FAILED",
      entityType: "lead",
      entityId: booking.id,
      details: {
        type: `booking_reminder_${type}`,
        leadName: booking.name,
        error: `رقم غير صالح للواتساب: ${booking.phone}`,
        reason: "invalid_phone",
      },
    });
    return "failed";
  }
  // WhatsApp Cloud API يتوقع الصيغة الدولية بدون "+"
  const toPhone = phoneCheck.phone.replace("+", "");
  const bookingTime = booking.bookingDate
    ? new Date(booking.bookingDate).toLocaleString("ar-SA", {
        timeZone: RIYADH_TZ,
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : type === "evening"
    ? "غداً"
    : "اليوم";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumber}/messages`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toPhone,
          type: "template",
          template: {
            name: config.reminderTemplateName,
            language: { code: config.templateLanguage || "ar" },
            components: [
              {
                type: "body",
                // Meta named-parameters format — يطابق {{customer_name}} في القالب
                parameters: [
                  { type: "text", parameter_name: "customer_name", text: booking.name },
                  { type: "text", parameter_name: "appointment_time", text: bookingTime },
                  { type: "text", parameter_name: "service", text: booking.bookingService || "موعد" },
                ],
              },
            ],
          },
        }),
      },
    );
    clearTimeout(timeout);

    const data = await response.json().catch(() => ({}));

    // على 429/5xx: لا تسجّل — اتركها تُعاد في run تالٍ
    if (response.status === 429 || response.status >= 500) {
      return "retryable";
    }

    if (response.ok) {
      await db.insert(activityLog).values({
        tenantId: config.tenantId,
        action: "WHATSAPP_SENT",
        entityType: "lead",
        entityId: booking.id,
        details: {
          type: `booking_reminder_${type}`,
          to: toPhone,
          leadName: booking.name,
          bookingDate: bookingTime,
          templateName: config.reminderTemplateName,
          messageId: data?.messages?.[0]?.id,
        },
      });
      return "sent";
    }

    // 4xx نهائي — سجّل فشل
    await db.insert(activityLog).values({
      tenantId: config.tenantId,
      action: "WHATSAPP_FAILED",
      entityType: "lead",
      entityId: booking.id,
      details: {
        type: `booking_reminder_${type}`,
        to: toPhone,
        leadName: booking.name,
        error: data?.error?.message ?? `HTTP ${response.status}`,
      },
    });
    return "failed";
  } catch (err) {
    // Network / timeout — قابل للإعادة
    logger.error("reminder network error", err, {
      leadId: booking.id,
      tenantId: config.tenantId,
    });
    return "retryable";
  }
}

function getRiyadhDate(offsetDays: number = 0): { start: Date; end: Date } {
  const now = new Date();
  // الوقت الحالي بتوقيت الرياض
  const riyadhStr = now.toLocaleDateString("en-CA", { timeZone: RIYADH_TZ }); // YYYY-MM-DD
  const [y, m, d] = riyadhStr.split("-").map(Number);
  
  // بداية اليوم بتوقيت الرياض = 21:00 UTC اليوم السابق
  const start = new Date(Date.UTC(y, m - 1, d + offsetDays, -3, 0, 0)); // UTC-3 offset
  const end = new Date(start.getTime() + 86400000);
  
  return { start, end };
}

export async function GET(request: NextRequest) {
  // التحقق من المفتاح السري — header مُفضّل (لا يظهر في logs)، query مدعوم للتوافق
  const provided =
    request.headers.get("x-cron-key") ??
    request.nextUrl.searchParams.get("secret") ??
    "";
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(cronSecret);
  const valid =
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf);
  if (!valid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // نوع التذكير: evening (اليوم السابق) أو morning (يوم الموعد)
  const type = request.nextUrl.searchParams.get("type") || "morning";
  if (type !== "evening" && type !== "morning") {
    return NextResponse.json({ error: "type must be 'evening' or 'morning'" }, { status: 400 });
  }

  try {
    const { start: rangeStart, end: rangeEnd } =
      type === "evening" ? getRiyadhDate(1) : getRiyadhDate(0);
    const now = new Date();

    const configs = await db
      .select({
        tenantId: whatsappConfigs.tenantId,
        apiKeyEncrypted: whatsappConfigs.apiKeyEncrypted,
        phoneNumber: whatsappConfigs.phoneNumber,
        reminderTemplateName: whatsappConfigs.reminderTemplateName,
        templateLanguage: whatsappConfigs.templateLanguage,
        isActive: whatsappConfigs.isActive,
        reminderEvening: whatsappConfigs.reminderEvening,
        reminderMorning: whatsappConfigs.reminderMorning,
      })
      .from(whatsappConfigs)
      .where(eq(whatsappConfigs.isActive, true));

    // معالجة كل tenant بالتوازي (في حدود العقل)
    const TENANT_CONCURRENCY = 3;
    const BOOKING_CONCURRENCY = 5;

    type TenantStats = { sent: number; failed: number; skipped: number };

    const processTenant = async (
      config: (typeof configs)[number],
    ): Promise<TenantStats> => {
      const stats: TenantStats = { sent: 0, failed: 0, skipped: 0 };

      if (!config.reminderTemplateName || !config.apiKeyEncrypted || !config.phoneNumber) {
        stats.skipped++;
        return stats;
      }
      if (type === "evening" && !config.reminderEvening) {
        stats.skipped++;
        return stats;
      }
      if (type === "morning" && !config.reminderMorning) {
        stats.skipped++;
        return stats;
      }

      // حجوزات في النطاق + في المستقبل فقط (لا تُذكّر بمواعيد فائتة)
      const bookings = await db
        .select({
          id: leads.id,
          name: leads.name,
          phone: leads.phone,
          bookingDate: leads.bookingDate,
          bookingService: leads.bookingService,
        })
        .from(leads)
        .where(
          and(
            eq(leads.tenantId, config.tenantId),
            eq(leads.isDeleted, false),
            eq(leads.bookingStatus, "PENDING"),
            isNotNull(leads.phone),
            gte(leads.bookingDate, rangeStart),
            lte(leads.bookingDate, rangeEnd),
            gte(leads.bookingDate, now),
          ),
        );

      if (bookings.length === 0) return stats;

      // duplicate check
      const { start: todayStart, end: todayEnd } = getRiyadhDate(0);
      const alreadySent = await db
        .select({ entityId: activityLog.entityId })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.tenantId, config.tenantId),
            eq(activityLog.action, "WHATSAPP_SENT"),
            gte(activityLog.createdAt, todayStart),
            lte(activityLog.createdAt, todayEnd),
            sql`${activityLog.details}->>'type' = ${"booking_reminder_" + type}`,
          ),
        );
      const sentIds = new Set(alreadySent.map((r) => r.entityId));

      // decrypt مرة واحدة
      let accessToken: string;
      try {
        accessToken = decrypt(config.apiKeyEncrypted, `whatsapp:${config.tenantId}`);
      } catch (err) {
        // سجّل فشلاً واضحاً ليرى المالك في UI
        await db.insert(activityLog).values({
          tenantId: config.tenantId,
          action: "WHATSAPP_FAILED",
          entityType: "whatsapp_config",
          details: {
            type: `booking_reminder_${type}`,
            reason: "decryption_failed",
            error: err instanceof Error ? err.message : "unknown",
          },
        });
        stats.failed += bookings.length;
        return stats;
      }

      // أرسل في chunks متوازية
      const pending = bookings.filter((b) => b.phone && !sentIds.has(b.id));
      stats.skipped += bookings.length - pending.length;

      for (let i = 0; i < pending.length; i += BOOKING_CONCURRENCY) {
        const chunk = pending.slice(i, i + BOOKING_CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map((booking) =>
            sendReminder({
              booking,
              config,
              accessToken,
              type,
            }),
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            if (r.value === "sent") stats.sent++;
            else if (r.value === "retryable") stats.skipped++; // سيُعاد في run تالٍ
            else stats.failed++;
          } else {
            stats.failed++;
          }
        }
      }

      return stats;
    };

    const aggregate: TenantStats = { sent: 0, failed: 0, skipped: 0 };
    for (let i = 0; i < configs.length; i += TENANT_CONCURRENCY) {
      const chunk = configs.slice(i, i + TENANT_CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(processTenant));
      for (const r of results) {
        if (r.status === "fulfilled") {
          aggregate.sent += r.value.sent;
          aggregate.failed += r.value.failed;
          aggregate.skipped += r.value.skipped;
        } else {
          aggregate.failed++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      type,
      sent: aggregate.sent,
      failed: aggregate.failed,
      skipped: aggregate.skipped,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 500 }
    );
  }
}
