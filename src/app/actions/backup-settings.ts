"use server";

import { db } from "@/db";
import { tenants } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertRole, ROLE } from "@/lib/tenant-guards";
import { testBackupConnection } from "@/lib/backup-push";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomBytes } from "crypto";

const updateBackupSchema = z.object({
  url: z.string().url().startsWith("https://").max(500).optional(),
  secret: z.string().min(8).max(200).optional(),
  enabled: z.boolean(),
});

/**
 * يحفظ إعدادات backup للـ tenant
 */
export async function saveBackupSettings(input: {
  url?: string;
  secret?: string;
  enabled: boolean;
}) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  // إذا enabled، URL و secret لازمان
  if (input.enabled) {
    if (!input.url || !input.url.startsWith("https://")) {
      throw new Error("URL غير صالح — يجب أن يبدأ بـ https://");
    }
    if (!input.secret || input.secret.length < 8) {
      throw new Error("السر يجب أن يكون 8 حروف على الأقل");
    }
  }

  const parsed = updateBackupSchema.parse(input);

  const update: Record<string, unknown> = {
    backupSheetEnabled: parsed.enabled,
  };
  if (parsed.url !== undefined) update.backupSheetUrl = parsed.url;
  if (parsed.secret !== undefined) update.backupSheetSecret = parsed.secret;
  // مسح آخر خطأ عند الحفظ
  update.backupLastError = null;

  await db
    .update(tenants)
    .set({
      settings: sql`COALESCE(settings, '{}'::jsonb) || ${JSON.stringify(update)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  revalidatePath("/settings/backup");
  return { success: true };
}

/**
 * يولّد سر عشوائي قوي للـ backup
 */
export async function generateBackupSecret(): Promise<string> {
  await requireTenant();
  return randomBytes(24).toString("base64url");
}

/**
 * يختبر الاتصال مع Apps Script Web App
 */
export async function testBackupAction(input: { url: string; secret: string }) {
  const { role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  return testBackupConnection(input);
}

/**
 * جلب حالة backup الحالية للعرض
 */
export async function getBackupStatus() {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const [t] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  type BackupSettings = {
    backupSheetUrl?: string;
    backupSheetSecret?: string;
    backupSheetEnabled?: boolean;
    backupLastSyncAt?: string;
    backupLastError?: string;
  };
  const s = (t?.settings ?? {}) as BackupSettings;

  return {
    enabled: !!s.backupSheetEnabled,
    url: s.backupSheetUrl ?? "",
    hasSecret: !!s.backupSheetSecret,
    secret: s.backupSheetSecret ?? "",
    lastSyncAt: s.backupLastSyncAt ?? null,
    lastError: s.backupLastError ?? null,
  };
}
