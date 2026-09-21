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

      CREATE TABLE IF NOT EXISTS customers (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        phone      TEXT NOT NULL,
        email      TEXT,
        id_number  TEXT,
        notes      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone);
      CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (lower(name));

      CREATE TABLE IF NOT EXISTS containers (
        id         SERIAL PRIMARY KEY,
        label      TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Admin-editable per-module rate table (§5.2 of the booking MVP spec) —
      -- ships empty; admin adds package rows (e.g. Daily/Weekly for
      -- shared_storage) with real prices before taking live bookings.
      CREATE TABLE IF NOT EXISTS rate_packages (
        id           SERIAL PRIMARY KEY,
        module_type  TEXT NOT NULL DEFAULT 'shared_storage',
        package_name TEXT NOT NULL,
        price        NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (module_type, package_name)
      );

      -- The core generic booking object (module-agnostic per the spec's §4
      -- shared data model) — only module_type = 'shared_storage' is active
      -- in the MVP; the others are reserved for later modules so this table
      -- doesn't need rework when they're added.
      CREATE TABLE IF NOT EXISTS bookings (
        id                 SERIAL PRIMARY KEY,
        customer_id        INTEGER NOT NULL REFERENCES customers(id),
        module_type        TEXT NOT NULL DEFAULT 'shared_storage'
                             CHECK (module_type IN ('shared_storage', 'co_working', 'meeting_room', 'studio')),
        package_type       TEXT NOT NULL,
        start_date         DATE NOT NULL,
        end_date           DATE,
        price              NUMERIC(12,2) NOT NULL,
        container_id       INTEGER REFERENCES containers(id),
        status             TEXT NOT NULL DEFAULT 'Pending Payment'
                             CHECK (status IN ('Pending Payment', 'Confirmed', 'Active', 'Completed', 'Cancelled', 'No-Show')),
        payment_status     TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Paid')),
        payment_reference  TEXT,
        source             TEXT NOT NULL CHECK (source IN ('Online Inquiry', 'Walk-in')),
        created_by         TEXT,
        notes              TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings (status);
      CREATE INDEX IF NOT EXISTS bookings_container_idx ON bookings (container_id);
      CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings (customer_id);
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
