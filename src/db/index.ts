import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL required — refusing to start");
}

// Connection for queries (pooled)
const client = postgres(connectionString, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
  connection: {
    // query واحد سيء لن يحبس اتصال لأكثر من 30 ثانية
    statement_timeout: 30_000,
    // transaction مفتوح لأكثر من دقيقة = اتصال مُسرَّب
    idle_in_transaction_session_timeout: 60_000,
  },
  onnotice: () => {},
});

export const db = drizzle(client, { schema });

export type Database = typeof db;
