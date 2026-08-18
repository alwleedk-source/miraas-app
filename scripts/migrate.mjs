// Production-safe migrator. Runs at container start in Coolify.
// - No tsx dep (plain Node ESM) → works with prod-only installs.
// - Idempotent: matches "already exists" / "duplicate" SQL state and continues.
// - Fails the process on any other error so Coolify aborts the deploy.
// - Advisory lock: concurrent replicas (rolling deploy) can't race the same DB.

import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.log("⚠️  DATABASE_URL not set — skipping migrations.");
  process.exit(0);
}

const client = postgres(connectionString, { max: 1, idle_timeout: 10 });
const migrationsDir = join(process.cwd(), "drizzle/migrations");

// قفل ثابت مشتق من "MERAS" (0x4D45524153) — session-level lock يمنع نسختين
// متوازيتين (rolling deploy) من تطبيق migrations في آنٍ واحد. يُحرَّر تلقائياً
// لو انقطع الاتصال، لكن نحرّره صراحةً في finally.
const MIGRATION_LOCK_ID = 331875500371;

let lockHeld = false;
let hadHardFailure = false;

try {
  await client.unsafe(`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`);
  lockHeld = true;

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("ℹ️  No migration files found.");
  } else {
    console.log(`🔄 Running ${files.length} migration file(s)...`);

    for (const file of files) {
      console.log(`\n📄 ${file}`);
      const sql = readFileSync(join(migrationsDir, file), "utf-8");

      const statements = sql
        .split(";")
        .map((s) =>
          s
            .split("\n")
            .filter((line) => !line.trim().startsWith("--"))
            .join("\n")
            .trim(),
        )
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        const preview = stmt.substring(0, 70).replace(/\s+/g, " ");
        try {
          await client.unsafe(stmt);
          console.log(`  ✅ ${preview}${stmt.length > 70 ? "…" : ""}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const benign =
            msg.includes("already exists") ||
            msg.includes("duplicate") ||
            msg.includes("does not exist") && stmt.toUpperCase().startsWith("DROP");
          if (benign) {
            console.log(`  ⏭️  skip (${msg.split("\n")[0]}): ${preview}`);
          } else {
            console.error(`  ❌ FAIL: ${msg}`);
            console.error(`     stmt: ${preview}`);
            hadHardFailure = true;
          }
        }
      }
    }
  }
} finally {
  if (lockHeld) {
    await client
      .unsafe(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`)
      .catch(() => {});
  }
  await client.end();
}

if (hadHardFailure) {
  console.error("\n❌ Migrations completed with errors — aborting boot.");
  process.exit(1);
}

console.log("\n✅ All migrations applied.");
process.exit(0);
