"use server";

import { logger } from "@/lib/logger";
import { getSession } from "@/lib/auth-server";

/**
 * يستقبل errors من client error boundaries ويخزّنها في error_log.
 * لا يحتاج صلاحيات — أي user authed يستطيع الإبلاغ عن client crash.
 */
export async function logClientError(input: {
  message: string;
  digest?: string;
  stack?: string;
  url?: string;
}) {
  // حد أقصى على الحجم لمنع log spam
  const message = input.message.slice(0, 500);
  const stack = input.stack?.slice(0, 5000);
  const url = input.url?.slice(0, 500);

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

  logger.error(`client: ${message}`, new Error(message), {
    tenantId,
    userId,
    url,
    digest: input.digest,
    stack,
    source: "client",
  });
}
