import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * DB initialization — يضمن أن التطبيق يستمع على port 3000 حتى
 * لو DATABASE_URL مفقود (وقتها كل query يفشل لكن /api/health يعمل ويُبلغ).
 *
 * استراتيجية: استخدم placeholder URL غير صالح كـ fallback.
 * postgres-js لا يحاول الاتصال حتى أول query.
 * النتيجة: import يمر بسلاسة، queries تفشل بخطأ واضح، health endpoint يكشف الحقيقة.
 */

const PLACEHOLDER_URL =
  "postgres://placeholder:placeholder@db-not-configured.invalid:5432/placeholder";

const realUrl = process.env.DATABASE_URL;
export const isDatabaseConfigured = !!realUrl && realUrl.startsWith("postgres");

if (!isDatabaseConfigured) {
  console.error(
    "⚠️  DATABASE_URL not set or invalid — app will start but queries will fail.\n" +
      "    Check Coolify env vars: DATABASE_URL must be Available at Runtime.",
  );
}

const client = postgres(realUrl ?? PLACEHOLDER_URL, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
  connection: {
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
  },
  onnotice: () => {},
});

export const db = drizzle(client, { schema });

export type Database = typeof db;
