import { Pool } from "pg";

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
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

let schemaReadyPromise: Promise<void> | undefined;

// Cheap to call on every request: after the first successful run in a warm
// serverless instance, this is a no-op CREATE TABLE IF NOT EXISTS.
export function ensureSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = query(`
      CREATE TABLE IF NOT EXISTS occupancy_snapshots (
        snapshot_date   DATE NOT NULL,
        site_id         TEXT NOT NULL,
        site_name       TEXT NOT NULL,
        total_units     INTEGER NOT NULL,
        occupied_units  INTEGER NOT NULL,
        available_units INTEGER NOT NULL,
        reserved_units  INTEGER NOT NULL,
        blocked_units   INTEGER NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (snapshot_date, site_id)
      );

      CREATE TABLE IF NOT EXISTS notified_paid_invoices (
        invoice_id  TEXT PRIMARY KEY,
        notified_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `).then(() => undefined);
  }
  return schemaReadyPromise;
}

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
