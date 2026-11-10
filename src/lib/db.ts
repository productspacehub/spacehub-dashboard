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

// Storeganise's invoice-paid webhook is labeled BETA and has occasionally failed to
// deliver at all (silently, with no error and no retry-exhausted alert). This table lets
// both the webhook handler and a periodic reconciliation cron share one record of which
// invoices have already been notified, so the cron can safely re-check recent invoices
// without risking a duplicate Slack message for ones the webhook already caught.
export async function isInvoiceNotified(invoiceId: string): Promise<boolean> {
  const rows = await query("SELECT 1 FROM notified_paid_invoices WHERE invoice_id = $1", [invoiceId]);
  return rows.length > 0;
}

export async function recordInvoiceNotified(invoiceId: string): Promise<void> {
  await query("INSERT INTO notified_paid_invoices (invoice_id) VALUES ($1) ON CONFLICT DO NOTHING", [invoiceId]);
}
