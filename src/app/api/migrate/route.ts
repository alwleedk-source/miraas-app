import { NextResponse } from "next/server";
import postgres from "postgres";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET(request: Request) {
  // حماية بسيطة — فقط بالتوكن
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (token !== "meras_migrate_2026") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }

  const client = postgres(connectionString, { max: 1 });
  const results: string[] = [];

  try {
    const migrationSQL = readFileSync(
      join(process.cwd(), "drizzle/migrations/0001_smart_scheduling.sql"),
      "utf-8"
    );

    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      try {
        await client.unsafe(statement);
        results.push(`✅ ${statement.substring(0, 60)}...`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already exists") || msg.includes("duplicate")) {
          results.push(`⏭️ Already exists: ${statement.substring(0, 50)}`);
        } else {
          results.push(`❌ Error: ${msg} — ${statement.substring(0, 60)}`);
        }
      }
    }

    await client.end();
    return NextResponse.json({ success: true, results });
  } catch (err) {
    await client.end();
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Migration failed",
    }, { status: 500 });
  }
}
