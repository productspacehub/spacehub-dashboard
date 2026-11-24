import { Pool } from "pg";

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    // BOOKING_STAGING_DATABASE_URL is set Preview-only (a second Neon database
    // connected to this project for staging the Bookings module) — preferring
    // it when present routes Preview deployments to that separate database
    // without touching the existing DATABASE_URL, which stays Production-and-
    // Preview-scoped from the original Neon integration and would otherwise
    // conflict with a Preview-only override of the same name.
    const connectionString = process.env.BOOKING_STAGING_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set. Connect a Postgres database to this project on Vercel.");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await getPool().query(text, params);
  return rows as T[];
}

// Runs `fn` in one transaction on one connection; rolls back if it throws.
export async function transaction<T>(fn: (q: (text: string, params?: unknown[]) => Promise<unknown[]>) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(async (text, params) => (await client.query(text, params)).rows);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// The schema lives in migrations/ (numbered SQL files), applied by
// scripts/migrate.mjs before every build — the app never creates or alters
// tables itself. To change the schema, add a new migration file; see README.
