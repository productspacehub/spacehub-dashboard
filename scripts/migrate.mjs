// Applies the numbered SQL files in migrations/ that this database hasn't run
// yet, in order, each in its own transaction, and records them in
// schema_migrations. Runs before `next build` (see package.json), so a deploy
// migrates its own database — Preview: staging, Production: production — and a
// failing migration fails the build while the previous deployment stays live.
//
//   npm run migrate              apply pending migrations
//   npm run migrate -- --status  list applied / pending, change nothing
//
// Rules: never edit a file that has been applied anywhere (its checksum is
// checked); add a new file instead. Migrations run while the previous code is
// still live, so they should only add (tables, nullable/defaulted columns,
// indexes) — remove things in a later migration, once no deployed code uses them.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "migrations");
const statusOnly = process.argv.includes("--status");

// Same choice of database as src/lib/db.ts (staging wins when its URL is set).
// The Neon integration also provides a direct, non-pooled URL (*_UNPOOLED);
// schema changes should use it when it's there.
loadEnvLocal();
const prefix = process.env.BOOKING_STAGING_DATABASE_URL ? "BOOKING_STAGING_DATABASE_URL" : "DATABASE_URL";
const urlVar = process.env[`${prefix}_UNPOOLED`] ? `${prefix}_UNPOOLED` : prefix;
const connectionString = process.env[urlVar];
if (!connectionString) {
  if (process.env.VERCEL) fail("No DATABASE_URL (or BOOKING_STAGING_DATABASE_URL) in this Vercel build — refusing to deploy without migrating.");
  console.warn("[migrate] No DATABASE_URL set; skipping migrations (local build without a database).");
  process.exit(0);
}

// Arbitrary fixed key: two builds (or a build and a manual run) never migrate
// at once. Transaction-scoped (pg_advisory_xact_lock) so it also holds through
// a pooled connection, and is released on commit/rollback whatever happens.
const LOCK_ID = 727384993;

const files = readdirSync(dir)
  .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
  .sort();
const checksum = (sql) => createHash("sha256").update(sql).digest("hex");

const client = new pg.Client({ connectionString });
await client.connect();
console.log(`[migrate] Using ${urlVar}.`);
try {
  await inLockedTransaction(() =>
    client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
  );
  const applied = await appliedMigrations();

  for (const [version, sum] of applied) {
    const file = files.find((f) => f === version);
    if (!file) console.warn(`[migrate] ${version} was applied here but its file is gone.`);
    else if (checksum(readFileSync(path.join(dir, file), "utf8")) !== sum) {
      fail(`${version} changed after it was applied. Revert the edit and put the change in a new migration file.`);
    }
  }

  const pending = files.filter((f) => !applied.has(f));
  if (statusOnly) {
    for (const f of files) console.log(`${applied.has(f) ? "applied" : "PENDING"}  ${f}`);
    process.exit(0);
  }
  if (pending.length === 0) console.log(`[migrate] Up to date (${files.length} migrations).`);

  for (const file of pending) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    try {
      const ran = await inLockedTransaction(async () => {
        // Another run may have applied it while this one waited for the lock.
        if ((await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file])).rows.length > 0) return false;
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum(sql)]);
        return true;
      });
      console.log(ran ? `[migrate] Applied ${file}` : `[migrate] ${file} was applied by another run meanwhile.`);
    } catch (err) {
      fail(`${file} failed and was rolled back: ${err instanceof Error ? err.message : err}`);
    }
  }
} finally {
  await client.end().catch(() => undefined);
}

async function inLockedTransaction(fn) {
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

async function appliedMigrations() {
  const { rows } = await client.query("SELECT version, checksum FROM schema_migrations");
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

function fail(message) {
  console.error(`[migrate] ${message}`);
  process.exit(1);
}

// `next` reads .env.local for the app; this script runs outside it.
function loadEnvLocal() {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
