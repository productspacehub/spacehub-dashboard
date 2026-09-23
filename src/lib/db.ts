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

let schemaReadyPromise: Promise<void> | undefined;

// Arbitrary constant for the advisory lock below — any fixed int64 works, it
// just needs to be the same value everywhere this runs.
const SCHEMA_LOCK_ID = 727384991;

// Cheap to call on every request: after the first successful run in a warm
// serverless instance, this is a no-op CREATE TABLE IF NOT EXISTS. On a
// genuinely empty database though, Vercel can spin up several serverless
// instances to serve concurrent requests (e.g. the home page's parallel
// module fetches) — each cold-starting its own schemaReadyPromise and racing
// to run these CREATE TABLE statements at once. "IF NOT EXISTS" alone isn't
// safe against that: two transactions can both see "doesn't exist yet" and
// collide creating the same table's row type in Postgres's pg_type catalog
// ("duplicate key value violates unique constraint pg_type_typname_nsp_index").
// pg_advisory_xact_lock serializes those instances around one connection —
// whoever loses the race just finds the tables already there — and releases
// automatically on commit/rollback, so it can't leak if this throws.
async function createSchema(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK_ID]);
    await client.query(`
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

      -- Admin-editable per-module addon menu (e.g. Co-working's free water
      -- refill/TV/lockers, §7.1) — same "ships empty, admin fills it in"
      -- pattern as rate_packages.
      CREATE TABLE IF NOT EXISTS addons (
        id           SERIAL PRIMARY KEY,
        module_type  TEXT NOT NULL,
        name         TEXT NOT NULL,
        price        NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (module_type, name)
      );

      -- Bookable rooms for Meeting Room / Studio (§7.2) — the calendar-module
      -- equivalent of Container, but availability isn't a single current
      -- Free/Assigned state: one room serves many different bookings across
      -- a day, just not overlapping ones, so "is it free" is always a
      -- time-range query against bookings (see checkResourceConflict in
      -- src/lib/bookings.ts) rather than a stored/derived status column.
      CREATE TABLE IF NOT EXISTS resources (
        id           SERIAL PRIMARY KEY,
        module_type  TEXT NOT NULL,
        name         TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (module_type, name)
      );

      -- The core generic booking object (module-agnostic per the spec's §4
      -- shared data model) — shared_storage, co_working, meeting_room, and
      -- studio are all active. start_time/end_time/resource_id are only
      -- used by the calendar modules (meeting_room/studio) — NULL
      -- everywhere else, same as container_id being unused outside
      -- shared_storage.
      CREATE TABLE IF NOT EXISTS bookings (
        id                 SERIAL PRIMARY KEY,
        customer_id        INTEGER NOT NULL REFERENCES customers(id),
        module_type        TEXT NOT NULL DEFAULT 'shared_storage'
                             CHECK (module_type IN ('shared_storage', 'co_working', 'meeting_room', 'studio')),
        package_type       TEXT NOT NULL,
        start_date         DATE NOT NULL,
        end_date           DATE,
        start_time         TIME,
        end_time           TIME,
        price              NUMERIC(12,2) NOT NULL,
        container_id       INTEGER REFERENCES containers(id),
        resource_id        INTEGER REFERENCES resources(id),
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
      CREATE INDEX IF NOT EXISTS bookings_resource_idx ON bookings (resource_id);
      -- Safety net for a bookings table that already existed before these
      -- columns were added (same reasoning as booking_addons.quantity below).
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_time TIME;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_time TIME;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS resource_id INTEGER REFERENCES resources(id);

      -- Selected addons per booking, snapshotted (name + price at the time of
      -- booking) rather than a foreign key to addons — so renaming, repricing,
      -- or removing an addon from the admin menu never changes what an
      -- already-made booking shows.
      CREATE TABLE IF NOT EXISTS booking_addons (
        id           SERIAL PRIMARY KEY,
        booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        addon_name   TEXT NOT NULL,
        price        NUMERIC(12,2) NOT NULL,
        quantity     INTEGER NOT NULL DEFAULT 1,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS booking_addons_booking_idx ON booking_addons (booking_id);
      -- ADD COLUMN IF NOT EXISTS rather than relying only on the CREATE TABLE
      -- above: this table may already exist (e.g. on the staging database)
      -- from before quantity was added, and CREATE TABLE IF NOT EXISTS is a
      -- no-op against an existing table — it wouldn't backfill the column.
      ALTER TABLE booking_addons ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
    `);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function ensureSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    // If this fails, let the next call retry from scratch instead of caching
    // a rejected promise forever.
    schemaReadyPromise = createSchema().catch((err) => {
      schemaReadyPromise = undefined;
      throw err;
    });
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
