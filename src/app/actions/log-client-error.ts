"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { logger } from "@/lib/logger";
import { getSession } from "@/lib/auth-server";
import { rateLimit } from "@/lib/rate-limit";

// تحقّق صارم — الـ endpoint عام (يقبل unauthenticated) فأي payload malformed
// كان يكسره مباشرة (input.message.slice على non-string = TypeError).
const clientErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  digest: z.string().max(200).optional(),
  stack: z.string().max(10_000).optional(),
  url: z.string().max(1000).optional(),
});

/**
 * يستقبل errors من client error boundaries ويخزّنها في error_log.
 * لا يحتاج صلاحيات — أي user authed يستطيع الإبلاغ عن client crash.
 */
export async function logClientError(input: unknown) {
  const parsed = clientErrorSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "بيانات غير صالحة" };
  }

  let tenantId: string | null = null;
  let userId: string | null = null;
  try {
    const session = await getSession();
    if (session?.user) {
      userId = session.user.id;
      const t = (session.user as { tenantId?: string }).tenantId;
      if (t) tenantId = t;
    }
  } catch {
    // ignore — unauthed errors still logged
  }

  // 🔒 rate limit — 10/دقيقة لكل مستخدم، أو لكل IP لغير المسجّلين.
  // endpoint كتابة عام بلا حد = تضخيم error_log بـ spam مجاني.
  let rateKey: string;
  if (userId) {
    rateKey = `client-err:u:${userId}`;
  } else {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    rateKey = `client-err:ip:${ip}`;
  }
  const rl = await rateLimit(rateKey, 10, 60_000);
  if (!rl.allowed) {
    return { success: false as const, error: "تم تجاوز الحد المسموح" };
  }

  // حد أقصى على الحجم لمنع log spam
  const message = parsed.data.message.slice(0, 500);
  const stack = parsed.data.stack?.slice(0, 5000);
  const url = parsed.data.url?.slice(0, 500);

  logger.error(`client: ${message}`, new Error(message), {
    tenantId,
    userId,
    url,
    digest: parsed.data.digest,
    stack,
    source: "client",
  });

  return { success: true as const };
}
