import postgres from "postgres";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("⚠️ DATABASE_URL is not set — skipping migration (OK for local dev)");
    process.exit(0);
  }

  const client = postgres(connectionString, { max: 1 });
  const migrationsDir = join(process.cwd(), "drizzle/migrations");

  console.log("🔄 Running migrations...");

  // نشغّل كل ملفات .sql بالترتيب الأبجدي (0000_... ثم 0001_... ثم 0002_...)
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  try {
    for (const file of files) {
      console.log(`\n📄 ${file}`);
      const migrationSQL = readFileSync(join(migrationsDir, file), "utf-8");

      const statements = migrationSQL
        .split(";")
        .map((s) =>
          // strip inline comments بين SQL السطور
          s
            .split("\n")
            .filter((line) => !line.trim().startsWith("--"))
            .join("\n")
            .trim(),
        )
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        try {
          await client.unsafe(statement);
          console.log("  ✅", statement.substring(0, 60).replace(/\s+/g, " ") + "...");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("already exists") || msg.includes("duplicate")) {
            console.log("  ⏭️ Already exists:", statement.substring(0, 50).replace(/\s+/g, " "));
          } else {
            console.error("  ❌ Error:", msg);
            console.error("     Statement:", statement.substring(0, 80).replace(/\s+/g, " "));
          }
        }
      }
    }

    console.log("\n✅ All migrations completed!");
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }

  await client.end();
  process.exit(0);
}

migrate();
