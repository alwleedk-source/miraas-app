import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("⚠️ DATABASE_URL is not set — skipping migration (OK for local dev)");
    process.exit(0);
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log("🔄 Running migration...");

  try {
    const migrationSQL = readFileSync(
      join(process.cwd(), "drizzle/migrations/0001_smart_scheduling.sql"),
      "utf-8"
    );

    // Split by semicolons and run each statement
    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      try {
        await client.unsafe(statement);
        console.log("✅", statement.substring(0, 60) + "...");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Ignore "already exists" errors
        if (msg.includes("already exists") || msg.includes("duplicate")) {
          console.log("⏭️ Already exists, skipping:", statement.substring(0, 50));
        } else {
          console.error("❌ Error:", msg);
          console.error("   Statement:", statement.substring(0, 80));
        }
      }
    }

    console.log("✅ Migration completed successfully!");
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }

  await client.end();
  process.exit(0);
}

migrate();
