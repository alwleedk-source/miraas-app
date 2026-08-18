/**
 * Backup Push — يدفع events إلى Google Sheet العميل (عبر Apps Script Web App)
 *
 * الفلسفة:
 *   - fire-and-forget — لا يؤخّر طلب المستخدم
 *   - silent fail — خطأ في sheet لا يكسر action في Meras
 *   - retry-once — محاولة واحدة إضافية بعد ثانية
 *   - record last error — يظهر في settings للمستخدم
 *
 * Apps Script في Sheet العميل يستقبل JSON ويعمل upsert.
 */

import { db } from "@/db";
import { tenants } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

export type BackupEventType =
  | "lead.created"
  | "lead.updated"
  | "lead.stage_changed"
  | "lead.assigned"
  | "lead.followup_added"
  | "lead.booked"
  | "lead.booking_status_changed"
  | "lead.archived"
  | "lead.unarchived"
  | "lead.deleted";

export type BackupPayload = {
  event: BackupEventType;
  timestamp: string;
  lead: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    priority: string;
    sourceName: string | null;
    stageName: string | null;
    assignedToName: string | null;
    bookingStatus: string | null;
    bookingDate: string | null;
    bookingService: string | null;
    bookingNotes: string | null;
    bookingDepartmentName: string | null;
    archivedAt: string | null;
    archiveReason: string | null;
    createdAt: string;
    updatedAt: string;
  };
  // event-specific extras
  meta?: {
    actorName?: string;
    note?: string;
    oldValue?: string;
    newValue?: string;
  };
};

const FETCH_TIMEOUT_MS = 8_000;

/**
 * حارس SSRF: الهدف الوحيد المشروع هو Google Apps Script Web App. نقصر الوجهة
 * على https + مضيفات Google فقط، فلا يمكن توجيه الـ fetch (الذي يعمل من الخادم)
 * إلى عناوين داخلية/شبكة خاصة أو endpoint بيانات السحابة (169.254.169.254).
 * Apps Script يعيد توجيهاً إلى script.googleusercontent.com (ضمن قائمة السماح).
 */
export function isAllowedBackupUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "script.google.com" || host === "script.googleusercontent.com";
  } catch {
    return false;
  }
}

/**
 * يدفع event للـ Sheet — async، يُستدعى بعد كل DB write.
 * استخدم void backupPush(...) لتجنّب await.
 */
export async function backupPush(
  tenantId: string,
  payload: BackupPayload,
): Promise<void> {
  try {
    // اقرأ settings — endpoint محفوظ في tenants.settings
    const [t] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    type BackupSettings = {
      backupSheetUrl?: string;
      backupSheetSecret?: string;
      backupSheetEnabled?: boolean;
    };
    const settings = (t?.settings ?? {}) as BackupSettings;

    if (!settings.backupSheetEnabled || !settings.backupSheetUrl) {
      return; // backup غير مفعّل — تخطّى صامتاً
    }

    // 🔒 SSRF guard — لا تُرسل إلا لمضيف Google Apps Script
    if (!isAllowedBackupUrl(settings.backupSheetUrl)) {
      logger.warn("backup push blocked: disallowed url host", { tenantId });
      void db
        .update(tenants)
        .set({
          settings: sql`COALESCE(settings, '{}'::jsonb) || ${JSON.stringify({
            backupLastError: "رابط النسخ غير مسموح — يجب أن يكون رابط Google Apps Script (https://script.google.com/...)",
          })}::jsonb`,
        })
        .where(eq(tenants.id, tenantId))
        .catch(() => {});
      return;
    }

    let success = await sendOnce(settings.backupSheetUrl, settings.backupSheetSecret ?? "", payload);

    if (!success) {
      await new Promise((r) => setTimeout(r, 1000));
      success = await sendOnce(settings.backupSheetUrl, settings.backupSheetSecret ?? "", payload);
    }

    // حدّث آخر مزامنة (أو خطأ) — async، لا يمنع
    const update = success
      ? { backupLastSyncAt: new Date().toISOString(), backupLastError: null }
      : { backupLastError: "آخر دفعة فشلت — راجع URL" };

    void db
      .update(tenants)
      .set({
        settings: sql`COALESCE(settings, '{}'::jsonb) || ${JSON.stringify(update)}::jsonb`,
      })
      .where(eq(tenants.id, tenantId))
      .catch(() => {});
  } catch (e) {
    logger.warn("backup push failed silently", {
      tenantId,
      event: payload.event,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function sendOnce(
  url: string,
  secret: string,
  payload: BackupPayload,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, ...payload }),
      // Apps Script Web App قد يُعيد 302 إلى googleusercontent — يجب اتباعه
      redirect: "follow",
    });
    clearTimeout(t);

    if (res.ok) return true;

    const body = await res.text().catch(() => "");
    logger.warn("backup push non-OK", { status: res.status, body: body.slice(0, 200) });
    return false;
  } catch (e) {
    logger.warn("backup push fetch error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/**
 * اختبار الاتصال — يُستدعى من Settings UI
 * يُرسل payload تجريبية ويرجع نتيجة فورية
 */
export async function testBackupConnection(args: {
  url: string;
  secret: string;
}): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  if (!isAllowedBackupUrl(args.url)) {
    return {
      ok: false,
      message: "الرابط يجب أن يكون رابط Google Apps Script (https://script.google.com/...)",
    };
  }
  if (!args.secret || args.secret.length < 8) {
    return { ok: false, message: "السر يجب أن يكون 8 حروف على الأقل" };
  }

  const testPayload: BackupPayload = {
    event: "lead.created",
    timestamp: new Date().toISOString(),
    lead: {
      id: "test-connection",
      name: "اختبار اتصال — Meras",
      phone: "+966500000000",
      email: null,
      priority: "MEDIUM",
      sourceName: "اختبار",
      stageName: null,
      assignedToName: null,
      bookingStatus: null,
      bookingDate: null,
      bookingService: null,
      bookingNotes: null,
      bookingDepartmentName: null,
      archivedAt: null,
      archiveReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    meta: { note: "هذا اختبار — يمكنك حذف هذه الصف من Sheet" },
  };

  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(args.url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: args.secret, ...testPayload }),
      redirect: "follow",
    });
    clearTimeout(t);
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return {
        ok: true,
        message: `✓ نجح الاتصال (${latencyMs}ms) — راجع Sheet لرؤية صف الاختبار`,
        latencyMs,
      };
    }
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      message: `استجابة غير ناجحة (${res.status}): ${body.slice(0, 150)}`,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "فشل الاتصال — تحقق من URL",
    };
  }
}
