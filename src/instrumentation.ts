/**
 * Instrumentation — يعمل مرة واحدة عند بدء كل Next.js server instance.
 * يتحقق من متغيرات البيئة الحرجة في production ويسجّل أي خلل بصوت عالٍ.
 *
 * قرار مقصود: نسجّل ولا نُسقط الإقلاع (no crash) — إسقاط الإقلاع بسبب env
 * ناقص يحوّل مشكلة إعداد إلى downtime كامل، و errors/warnings تظهر أيضاً في
 * /api/health?strict=1 للمراقبة. assertEnv (الصارم) متاح للاستخدام اليدوي/CI.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production"
  ) {
    const { validateEnv } = await import("./lib/env");
    const { ok, errors, warnings } = validateEnv();
    for (const w of warnings) console.warn(`⚠️ ENV: ${w}`);
    if (!ok) {
      console.error(
        `🚨 ENV validation failed in production (app keeps running — fix these in Coolify):\n  - ${errors.join("\n  - ")}`,
      );
    }
  }
}
