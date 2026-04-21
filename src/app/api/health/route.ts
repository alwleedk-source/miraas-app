import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { validateEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — للـ load balancer وعمليات رصد uptime
 *
 * يتحقّق من:
 *   - اتصال DB يعمل (SELECT 1)
 *   - الـ env vars صحيحة
 *
 * يرجّع 200 إذا كل شيء OK، 503 إذا أي شيء مكسور.
 * لا يكشف تفاصيل حساسة في production (فقط ok/degraded).
 */
export async function GET() {
  const isProd = process.env.NODE_ENV === "production";
  const checks: Record<string, "ok" | "fail"> = {};
  const errors: string[] = [];

  // 1. DB ping
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch (e) {
    checks.database = "fail";
    errors.push(e instanceof Error ? e.message : "db error");
  }

  // 2. env validation
  const envResult = validateEnv();
  checks.env = envResult.ok ? "ok" : "fail";
  if (!envResult.ok) errors.push(...envResult.errors);

  const allOk = Object.values(checks).every((v) => v === "ok");
  const body = allOk
    ? { status: "ok", timestamp: new Date().toISOString() }
    : {
        status: "degraded",
        checks,
        // لا تكشف errors في production — فقط في dev
        ...(isProd ? {} : { errors }),
      };

  return NextResponse.json(body, { status: allOk ? 200 : 503 });
}
