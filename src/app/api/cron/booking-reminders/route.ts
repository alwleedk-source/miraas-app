import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, whatsappConfigs, activityLog } from "@/db/schema";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";
import { decrypt } from "@/lib/encryption";

// =============================================
// Cron: تذكير حجوزات عبر واتساب
// مبني على دراسات: التذكير المزدوج يقلل عدم الحضور 39%
//
// رابطين في cron-job.org:
// 8 مساءً → ?type=evening (تذكير بحجوزات الغد)
// 8 صباحاً → ?type=morning (تذكير بحجوزات اليوم)
// =============================================

const CRON_SECRET = process.env.CRON_SECRET || "miras-cron-2026";

export async function GET(request: NextRequest) {
  // التحقق من المفتاح السري
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // نوع التذكير: evening (اليوم السابق) أو morning (يوم الموعد)
  const type = request.nextUrl.searchParams.get("type") || "morning";
  if (type !== "evening" && type !== "morning") {
    return NextResponse.json({ error: "type must be 'evening' or 'morning'" }, { status: 400 });
  }

  try {
    const now = new Date();
    let rangeStart: Date;
    let rangeEnd: Date;

    if (type === "evening") {
      // 8 مساءً — نذكّر بحجوزات الغد
      const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      rangeStart = tomorrowStart;
      rangeEnd = new Date(tomorrowStart.getTime() + 86400000);
    } else {
      // 8 صباحاً — نذكّر بحجوزات اليوم
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      rangeStart = todayStart;
      rangeEnd = new Date(todayStart.getTime() + 86400000);
    }

    // جلب كل الشركات المفعّلة للواتساب
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

    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    for (const config of configs) {
      // تخطي إذا لم يُعد قالب التذكير أو البيانات غير مكتملة
      if (!config.reminderTemplateName || !config.apiKeyEncrypted || !config.phoneNumber) {
        totalSkipped++;
        continue;
      }

      // تخطي إذا نوع التذكير معطّل لهذه الشركة
      if (type === "evening" && !config.reminderEvening) {
        totalSkipped++;
        continue;
      }
      if (type === "morning" && !config.reminderMorning) {
        totalSkipped++;
        continue;
      }

      // جلب الحجوزات في النطاق الزمني
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
            lte(leads.bookingDate, rangeEnd)
          )
        );

      if (bookings.length === 0) continue;

      // فك تشفير Access Token
      let accessToken: string;
      try {
        accessToken = decrypt(config.apiKeyEncrypted);
      } catch {
        totalFailed += bookings.length;
        continue;
      }

      // إرسال تذكير لكل عميل
      for (const booking of bookings) {
        if (!booking.phone) continue;

        const toPhone = booking.phone.replace(/\D/g, "");
        const bookingTime = booking.bookingDate
          ? new Date(booking.bookingDate).toLocaleString("ar-SA", {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : type === "evening" ? "غداً" : "اليوم";

        try {
          const response = await fetch(
            `https://graph.facebook.com/v21.0/${config.phoneNumber}/messages`,
            {
              method: "POST",
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
                      parameters: [
                        { type: "text", text: booking.name },
                        { type: "text", text: bookingTime },
                        { type: "text", text: booking.bookingService || "موعد" },
                      ],
                    },
                  ],
                },
              }),
            }
          );

          const data = await response.json();

          if (response.ok) {
            totalSent++;
          } else {
            totalFailed++;
          }

          // تسجيل النشاط
          await db.insert(activityLog).values({
            tenantId: config.tenantId,
            action: response.ok ? "WHATSAPP_SENT" : "WHATSAPP_FAILED",
            entityType: "lead",
            entityId: booking.id,
            details: {
              type: `booking_reminder_${type}`,
              to: toPhone,
              leadName: booking.name,
              bookingDate: bookingTime,
              templateName: config.reminderTemplateName,
              messageId: data.messages?.[0]?.id,
              error: data.error?.message,
            },
          });
        } catch {
          totalFailed++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      type,
      sent: totalSent,
      failed: totalFailed,
      skipped: totalSkipped,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 500 }
    );
  }
}
