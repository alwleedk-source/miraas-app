import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, whatsappConfigs, activityLog } from "@/db/schema";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";
import { decrypt } from "@/lib/encryption";

// =============================================
// Cron: تذكير حجوزات الغد عبر واتساب
// يُستدعى يومياً الساعة 8 صباحاً عبر cron-job.org
// GET /api/cron/booking-reminders?secret=XXXXX
// =============================================

const CRON_SECRET = process.env.CRON_SECRET || "miras-cron-2026";

export async function GET(request: NextRequest) {
  // التحقق من المفتاح السري
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // حساب نطاق "الغد"
    const now = new Date();
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrowEnd = new Date(tomorrowStart.getTime() + 86400000);

    // جلب كل الشركات المفعّلة للواتساب
    const configs = await db
      .select({
        tenantId: whatsappConfigs.tenantId,
        apiKeyEncrypted: whatsappConfigs.apiKeyEncrypted,
        phoneNumber: whatsappConfigs.phoneNumber,
        reminderTemplateName: whatsappConfigs.reminderTemplateName,
        templateLanguage: whatsappConfigs.templateLanguage,
        isActive: whatsappConfigs.isActive,
      })
      .from(whatsappConfigs)
      .where(eq(whatsappConfigs.isActive, true));

    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    for (const config of configs) {
      // تخطي إذا لم يُعد قالب التذكير
      if (!config.reminderTemplateName || !config.apiKeyEncrypted || !config.phoneNumber) {
        totalSkipped++;
        continue;
      }

      // جلب حجوزات الغد لهذه الشركة
      const tomorrowBookings = await db
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
            gte(leads.bookingDate, tomorrowStart),
            lte(leads.bookingDate, tomorrowEnd)
          )
        );

      if (tomorrowBookings.length === 0) continue;

      // فك تشفير Access Token
      let accessToken: string;
      try {
        accessToken = decrypt(config.apiKeyEncrypted);
      } catch {
        totalFailed += tomorrowBookings.length;
        continue;
      }

      // إرسال تذكير لكل عميل
      for (const booking of tomorrowBookings) {
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
          : "غداً";

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
              type: "booking_reminder",
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
