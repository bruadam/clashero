import { Pool } from "pg";

let pool: Pool | null = null;

export function getPgPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  // Allow Next.js build to succeed without DB. Runtime routes that touch the DB
  // will still error if DATABASE_URL is missing.
  if (!connectionString) {
    if (!pool) {
      pool = new Pool({ connectionString: "postgres://invalid/disabled" });
    }
    return pool;
  }

  if (!pool) {
    pool = new Pool({ connectionString });
  }

  return pool;
}
