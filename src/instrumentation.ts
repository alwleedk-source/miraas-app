/**
 * Instrumentation — يعمل مرة واحدة عند بدء كل Next.js server instance.
 * نستخدمه للتحقق من متغيرات البيئة الحرجة في production (fail-fast):
 * لو نقص سرّ، يفشل الإقلاع بخطأ واضح بدل أخطاء runtime غامضة لاحقاً.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production"
  ) {
    const { assertEnv } = await import("./lib/env");
    assertEnv();
  }
}
