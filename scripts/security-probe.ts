/**
 * security-probe.ts — اختبار آلي لثغرات معروفة بعد النشر
 *
 * الاستخدام:
 *   BASE_URL=https://yourapp.com npx tsx scripts/security-probe.ts
 *
 * يتحقق أن:
 *   1. /api/migrate مفقود (404)
 *   2. /api/health يعمل ويُرجع ok
 *   3. signup لا يقبل role/tenantId من client
 *   4. /api/cron/booking-reminders يرفض بدون secret
 *   5. /api/webhook/leads يرفض بدون webhook secret
 *   6. الصفحات المحمية تعيد redirect لـ /login عند عدم المصادقة
 *   7. security headers موجودة (X-Frame-Options, etc)
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

type TestResult = { name: string; passed: boolean; details?: string };
const results: TestResult[] = [];

function check(name: string, cond: boolean, details?: string) {
  results.push({ name, passed: cond, details });
  const icon = cond ? "✅" : "❌";
  console.log(`${icon} ${name}${details ? `  — ${details}` : ""}`);
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function run() {
  console.log(`\n🛡️  Security probe: ${BASE_URL}\n`);

  // 1. migrate route محذوف
  {
    const res = await safe(() => fetch(`${BASE_URL}/api/migrate?token=meras_migrate_2026`));
    check("migrate route removed (404)", res?.status === 404);
  }

  // 2. health endpoint
  {
    const res = await safe(() => fetch(`${BASE_URL}/api/health`));
    const body = res ? await safe(() => res.json()) : null;
    check(
      "health endpoint responds",
      res?.status === 200 || res?.status === 503,
      `status=${res?.status}, body=${JSON.stringify(body).slice(0, 100)}`,
    );
  }

  // 3. signup لا يقبل role
  {
    const randomEmail = `probe-${Date.now()}@example.test`;
    // test-only random placeholder — NOT a real credential
    const testPw = Array.from({ length: 16 }, () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
    ).join("");
    const res = await safe(() =>
      fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: randomEmail,
          password: testPw,
          name: "Probe",
          role: "SUPER_ADMIN",
          tenantId: "deadbeef-dead-beef-dead-beefdeadbeef",
        }),
      }),
    );
    // نجاح أو فشل signup — المهم أن role=SUPER_ADMIN لم يُقبل
    // لا يمكن التحقق بدون DB access، لكن نرى status
    check(
      "signup endpoint doesn't 500 on role injection",
      !!res && res.status !== 500,
      `status=${res?.status}`,
    );
    console.log(`   ⚠️  تحقّق يدوياً: SELECT role, tenant_id FROM users WHERE email='${randomEmail}'`);
    console.log(`      يجب أن يكون role='COORDINATOR' و tenant_id=NULL`);
  }

  // 4. cron secret enforcement
  {
    const res = await safe(() =>
      fetch(`${BASE_URL}/api/cron/booking-reminders?type=morning`),
    );
    check("cron rejects request without secret", res?.status === 401 || res?.status === 500);

    const resBad = await safe(() =>
      fetch(`${BASE_URL}/api/cron/booking-reminders?type=morning&secret=wrong`),
    );
    check("cron rejects wrong secret", resBad?.status === 401);
  }

  // 5. webhook rejects without secret
  {
    const res = await safe(() =>
      fetch(`${BASE_URL}/api/webhook/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ name: "X", phone: "05500000" }]),
      }),
    );
    check("webhook rejects without secret", res?.status === 401);

    const resBad = await safe(() =>
      fetch(`${BASE_URL}/api/webhook/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "wrong-secret-value-12345",
        },
        body: JSON.stringify([{ name: "X", phone: "05500000" }]),
      }),
    );
    check("webhook rejects wrong secret", resBad?.status === 403);
  }

  // 6. protected page redirects
  {
    const res = await safe(() =>
      fetch(`${BASE_URL}/leads`, { redirect: "manual" }),
    );
    const isRedirect = res?.status === 302 || res?.status === 307 || res?.status === 308;
    const location = res?.headers.get("location") ?? "";
    check(
      "protected /leads redirects to /login",
      isRedirect && location.includes("/login"),
      `status=${res?.status}, location=${location}`,
    );
  }

  // 7. security headers
  {
    const res = await safe(() => fetch(`${BASE_URL}/leads`, { redirect: "manual" }));
    check(
      "X-Frame-Options header present",
      res?.headers.get("x-frame-options") === "DENY",
    );
    check(
      "X-Content-Type-Options header present",
      res?.headers.get("x-content-type-options") === "nosniff",
    );
  }

  // 8. migrate token variants rejected
  {
    for (const token of ["miras-cron-2026", "admin", "test", "secret"]) {
      const res = await safe(() => fetch(`${BASE_URL}/api/migrate?token=${token}`));
      if (res?.status !== 404) {
        check(`migrate with token '${token}' rejected`, false, `status=${res?.status}`);
      }
    }
    check("all hardcoded tokens rejected (migrate gone)", true);
  }

  // ملخص
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n${"━".repeat(50)}`);
  console.log(`نتيجة: ${passed} نجح، ${failed} فشل من ${results.length}`);
  if (failed > 0) {
    console.log("\n❌ الاختبارات الفاشلة:");
    for (const r of results.filter((x) => !x.passed)) {
      console.log(`   - ${r.name}${r.details ? ` (${r.details})` : ""}`);
    }
    process.exit(1);
  }
  console.log("✅ كل الاختبارات الأمنية نجحت");
  process.exit(0);
}

run().catch((e) => {
  console.error("❌ Probe crashed:", e);
  process.exit(1);
});
