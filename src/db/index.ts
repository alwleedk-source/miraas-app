import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

/**
 * Lazy DB initialization.
 *
 * التطبيق يستمع على port 3000 فوراً حتى لو DATABASE_URL مفقود مؤقتاً —
 * بدل crash عند import time والذي يقتل healthcheck.
 *
 * أول query فعلي يُنشئ الاتصال. إذا env مفقود، يرمي خطأ واضح يُعرض في /api/health.
 */

let _client: Sql | null = null;

function getClient(): Sql {
  if (_client) return _client;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL not set — check Coolify env vars (must be Runtime, not Buildtime-only)",
    );
  }

  _client = postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 60_000,
    },
    onnotice: () => {},
  });

  return _client;
}

/**
 * Proxy على دالة وهمية — يدعم استخدام postgres كـ tagged template
 * (sql`...`) و كـ object (sql.unsafe(), sql.end()).
 */
const lazyClient = new Proxy(function () {} as unknown as Sql, {
  apply(_target, _thisArg, args) {
    const c = getClient() as unknown as (...a: unknown[]) => unknown;
    return c(...args);
  },
  get(_target, prop, _receiver) {
    const c = getClient() as unknown as Record<string | symbol, unknown>;
    const v = c[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});

export const db = drizzle(lazyClient, { schema });

export type Database = typeof db;
