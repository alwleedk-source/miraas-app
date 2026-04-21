/**
 * Logger — console + Postgres (بديل Sentry، صفر تكلفة)
 *
 * - يطبع على console دائماً.
 * - يكتب في جدول error_log في DB (fire-and-forget — لا يؤخّر الطلب).
 * - المدير يشاهد الأخطاء من /settings/errors.
 *
 * Axiom/GlitchTip يمكن إضافتها لاحقاً عبر env var — راجع التعليق في نهاية الملف.
 */

import { createHash } from "crypto";

type LogContext = Record<string, unknown>;

function fmt(ctx?: LogContext): string {
  if (!ctx) return "";
  try {
    return " " + JSON.stringify(ctx);
  } catch {
    return " [context unserialisable]";
  }
}

function fingerprint(message: string, errName?: string): string {
  return createHash("sha256")
    .update(`${errName ?? ""}|${message}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * يكتب الخطأ في DB بدون أن يؤخّر الطلب.
 * lazy-import drizzle/db عند الحاجة لتجنّب circular deps.
 */
async function persist(
  level: "error" | "warn",
  message: string,
  err: unknown,
  ctx?: LogContext,
): Promise<void> {
  try {
    const { db } = await import("@/db");
    const { errorLog } = await import("@/db/schema");

    const errInstance = err instanceof Error ? err : undefined;
    const errName = errInstance?.name ?? (err ? String((err as { name?: string })?.name ?? "") : undefined);
    const errStack = errInstance?.stack;

    // نستخرج tenantId/userId/url من ctx إن كانوا موجودين
    const tenantId = typeof ctx?.tenantId === "string" ? ctx.tenantId : null;
    const userId = typeof ctx?.userId === "string" ? ctx.userId : null;
    const url = typeof ctx?.url === "string" ? ctx.url : null;

    // نسخة نظيفة من context بدون الحقول المرفوعة فوق
    const cleanCtx: Record<string, unknown> = { ...(ctx ?? {}) };
    delete cleanCtx.tenantId;
    delete cleanCtx.userId;
    delete cleanCtx.url;

    await db.insert(errorLog).values({
      tenantId,
      userId,
      level,
      message: message.slice(0, 2000),
      errorName: errName?.slice(0, 100) || null,
      errorStack: errStack?.slice(0, 10000) || null,
      context: cleanCtx,
      url,
      fingerprint: fingerprint(message, errName),
    });
  } catch {
    // ابتلاع آمن — لا نريد للـ logger أن يرمي
  }
}

export const logger = {
  info(message: string, ctx?: LogContext) {
    console.log(`[info] ${message}${fmt(ctx)}`);
  },

  warn(message: string, ctx?: LogContext) {
    console.warn(`[warn] ${message}${fmt(ctx)}`);
    // fire-and-forget
    void persist("warn", message, undefined, ctx);
  },

  error(message: string, err?: unknown, ctx?: LogContext) {
    const errMsg = err instanceof Error ? err.message : String(err ?? "");
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[error] ${message}${fmt({ ...ctx, error: errMsg })}`);
    if (stack && process.env.NODE_ENV !== "production") {
      console.error(stack);
    }
    // fire-and-forget
    void persist("error", message, err, ctx);
  },
};

/**
 * خيارات مستقبلية (عندما تحتاج alerts أو SaaS):
 *
 * 1. Axiom.co — 500GB/شهر مجاناً:
 *    pnpm add @axiomhq/js
 *    في persist(): axiom.ingest("errors", [{ ...data }]);
 *
 * 2. BetterStack Logtail — 1GB/شهر مجاناً:
 *    pnpm add @logtail/node
 *
 * 3. GlitchTip (self-hosted Sentry-compatible) في Coolify:
 *    add docker service glitchtip/glitchtip:latest
 *    pnpm add @sentry/nextjs + SENTRY_DSN=https://your-glitchtip-url/...
 *
 * كلها يمكن إضافتها بتغيير هذه الدالة فقط — الكود الذي يستخدم logger
 * لا يحتاج تعديل.
 */
