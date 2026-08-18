import { NextResponse } from "next/server";
import { db, isDatabaseConfigured } from "@/db";
import { sql } from "drizzle-orm";
import { validateEnv } from "@/lib/env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * يُرجع 200 دائماً إذا كان الـ app يستجيب — هذا ما يحتاجه Coolify
 * (liveness probe). تفاصيل DB/env في الـ body — لا نُسقط الـ app إذا
 * DB متعثر مؤقتاً، فقط نُبلّغ.
 *
 * إذا أردت probe تحقق DB حقيقي، استخدم /api/health?strict=1 → يُرجع 503
 * عندما أي subsystem فاشل.
 *
 * checks.migration: نتيجة آخر تشغيل للمهاجر عند الإقلاع (من ملف حالة يكتبه
 * scripts/migrate.mjs في tmpdir). تفاصيل الفشل (ملف/كود/رسالة) تُعرض في strict
 * فقط — تشخيص إنتاجي مقصود رغم سياسة إخفاء التفاصيل، لأن بديلها الوصول لسجلات
 * الحاوية. لا تحوي أسراراً — أسماء جداول/أعمدة فقط.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const strict = url.searchParams.get("strict") === "1";
  const isProd = process.env.NODE_ENV === "production";

  const checks: Record<string, "ok" | "fail"> = {};
  const errors: string[] = [];

  // 1. DB ping (مع timeout قصير حتى لا يحبس probe)
  if (!isDatabaseConfigured) {
    checks.database = "fail";
    errors.push("db: DATABASE_URL not set — check Coolify env (Runtime tab)");
  } else {
    try {
      await Promise.race([
        db.execute(sql`SELECT 1`),
        new Promise((_, rej) => setTimeout(() => rej(new Error("db timeout 3s")), 3000)),
      ]);
      checks.database = "ok";
    } catch (e) {
      checks.database = "fail";
      errors.push("db: " + (e instanceof Error ? e.message : String(e)).slice(0, 200));
    }
  }

  // 2. env validation
  const envResult = validateEnv();
  checks.env = envResult.ok ? "ok" : "fail";
  if (!envResult.ok) errors.push(...envResult.errors.map((m) => "env: " + m));

  // 3. آخر تشغيل للمهاجر (ملف حالة من tmpdir — قد لا يوجد قبل أول إقلاع)
  let migrationDetails: unknown;
  try {
    const raw = readFileSync(join(tmpdir(), "meras-migration-status.json"), "utf-8");
    const status = JSON.parse(raw) as { ok: boolean; at?: string; failures?: unknown[] };
    checks.migration = status.ok ? "ok" : "fail";
    if (!status.ok) {
      errors.push(`migration: ${(status.failures?.length ?? 0)} statement(s) failed at boot`);
      // strict فقط: التفاصيل الكاملة للعبارات الفاشلة (تشخيص إنتاجي مقصود)
      if (strict) migrationDetails = status.failures;
    }
  } catch {
    checks.migration = "ok"; // لا ملف = لم يعمل المهاجر في هذه العملية (تطوير مثلاً)
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  const body = {
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
    // في الإنتاج لا نكشف تفاصيل الأخطاء (أسماء متغيّرات بيئة/رسائل DB) لمتصل غير موثّق.
    // الـ checks تُظهر أيّ نظام فرعي فشل (database/env/migration)، وstrict mode يعيد 503 للمراقبة.
    ...(isProd ? {} : { errors }),
    ...(migrationDetails ? { migrationFailures: migrationDetails } : {}),
  };

  // strict mode: 503 عند أي failure (للمراقبة الدقيقة)
  // default: 200 دائماً (لـ Coolify liveness)
  const httpStatus = strict && !allOk ? 503 : 200;

  return NextResponse.json(body, { status: httpStatus });
}
