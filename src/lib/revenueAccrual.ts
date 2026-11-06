import { classifyDescription, isDepositEntry } from "./cashin";
import { ensureSchema, query, transaction } from "./db";
import { jakartaToday } from "./snapshots";
import { fetchSites, paginate, pickTitle } from "./storeganise";

// Accrual revenue, by SpaceHub finance's rules:
// - Rent counts in full in the month its period starts; a line covering
//   several months (qty > 1, e.g. a prepayment) is split evenly, each part in
//   the month its own period starts.
// - Late fees and items count in the month the invoice was created.
// - Only paid invoices count (Storeganise marks an invoice paid only once it
//   is paid in full). A late payment still counts in the period's month, so a
//   past month can grow. No refunds; deposits are never revenue; no VAT.
//
// The service period lives on each invoice line (`date` → `endDate`, end
// exclusive); the invoice's own startDate/endDate are not the period.

export type RevenueCategory = "rent" | "lateFee" | "item" | "unclassified";
export const REVENUE_CATEGORIES: RevenueCategory[] = ["rent", "lateFee", "item", "unclassified"];

export type LineFlag = "qty_mismatch" | "rent_no_period";

export type InvoiceLine = {
  type?: string;
  desc?: string;
  date?: string;
  endDate?: string;
  qty?: number;
  total?: number;
};

export type AccrualInvoice = {
  id: string;
  siteId: string;
  state: string;
  created: string;
  updated?: string;
  paid?: string;
  entries?: InvoiceLine[];
};

export type Allocation = { line: number; part: number; month: string; category: RevenueCategory; amount: number; flag: LineFlag | null };

const jakartaMonthOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

// Whole months in [start, end): 19 Nov → 19 Dec = 1, 8 Dec → 8 Feb = 2.
export function monthsBetween(start: string, end: string): number {
  const [y1, m1, d1] = start.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = end.slice(0, 10).split("-").map(Number);
  let n = (y2 * 12 + m2) - (y1 * 12 + m1);
  if (d2 < d1) n -= 1;
  return n;
}

export function allocateInvoice(inv: AccrualInvoice): { allocations: Allocation[]; cashAmount: number } {
  const allocations: Allocation[] = [];
  const createdMonth = jakartaMonthOf(inv.created);
  let cashAmount = 0;
  (inv.entries ?? []).forEach((e, line) => {
    if (isDepositEntry(e)) return;
    const total = Number(e.total ?? 0);
    cashAmount += total;
    const kind = classifyDescription(e.desc);

    if (e.date && e.endDate) {
      const qty = Number(e.qty);
      const months = monthsBetween(e.date, e.endDate);
      const parts = Number.isInteger(qty) && qty >= 1 ? qty : Math.max(1, months);
      const flag: LineFlag | null = months === parts ? null : "qty_mismatch";
      const each = Math.round(total / parts);
      for (let part = 0; part < parts; part++) {
        allocations.push({
          line,
          part,
          month: addMonths(e.date.slice(0, 7), part),
          category: "rent",
          amount: part === parts - 1 ? total - each * (parts - 1) : each,
          flag,
        });
      }
      return;
    }
    if (kind === "lateFee" || kind === "item") {
      allocations.push({ line, part: 0, month: createdMonth, category: kind, amount: total, flag: null });
      return;
    }
    if (kind === "rent" || e.type === "prepayment") {
      // Rent with no period to place it: its own date if any, else the invoice's month.
      allocations.push({ line, part: 0, month: e.date ? e.date.slice(0, 7) : createdMonth, category: "rent", amount: total, flag: "rent_no_period" });
      return;
    }
    allocations.push({ line, part: 0, month: createdMonth, category: "unclassified", amount: total, flag: null });
  });
  return { allocations, cashAmount };
}

// ---------------------------------------------------------------- sync

// How far back invoices are kept in sync: 24 months, so a 12-month trend
// still sees long prepayments made before it starts.
const SYNC_MONTHS = 24;
const ENTRY_BATCH = 40; // Storeganise: include= only on small lists
const SYNC_LOCK_ID = 727384992;

// Storeganise's own `updated` plus state/paid: an invoice whose version
// hasn't changed since the last sync isn't fetched again.
const versionOf = (i: AccrualInvoice) => `${i.state}|${i.updated ?? ""}|${i.paid ?? ""}`;

export type SyncResult = { listed: number; changed: number; processed: number; pending: number };

export async function syncRevenue(timeBudgetMs = 40_000): Promise<SyncResult> {
  await ensureSchema();
  const started = Date.now();
  const from = `${addMonths(jakartaToday().slice(0, 7), -SYNC_MONTHS)}-01`;
  try {
    const listed = await paginate<AccrualInvoice>(`/v1/admin/invoices?start=${from}`);
    const stored = new Map(
      (await query<{ invoice_id: string; version: string }>("SELECT invoice_id, version FROM revenue_invoices")).map((r) => [r.invoice_id, r.version])
    );
    const changed = listed.filter((i) => stored.get(i.id) !== versionOf(i));

    let processed = 0;
    for (let i = 0; i < changed.length && Date.now() - started < timeBudgetMs; i += ENTRY_BATCH) {
      const ids = changed.slice(i, i + ENTRY_BATCH).map((x) => x.id);
      const full = await paginate<AccrualInvoice>(`/v1/admin/invoices?ids=${ids.join(",")}&include=entries`);
      await saveInvoices(full);
      processed += ids.length;
    }
    const pending = changed.length - processed;
    await query(
      `INSERT INTO revenue_sync (id, last_run, listed, pending, last_error) VALUES (1, now(), $1, $2, NULL)
       ON CONFLICT (id) DO UPDATE SET last_run = now(), listed = $1, pending = $2, last_error = NULL`,
      [listed.length, pending]
    );
    return { listed: listed.length, changed: changed.length, processed, pending };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `INSERT INTO revenue_sync (id, last_error) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET last_error = $1`,
      [message.slice(0, 500)]
    ).catch(() => undefined);
    throw err;
  }
}

async function saveInvoices(invoices: AccrualInvoice[]): Promise<void> {
  if (invoices.length === 0) return;
  const invRows: unknown[] = [];
  const lineRows: unknown[] = [];
  for (const inv of invoices) {
    const { allocations, cashAmount } = allocateInvoice(inv);
    const paidDate = inv.state === "paid" ? (inv.paid ?? inv.updated ?? inv.created).slice(0, 10) : null;
    invRows.push([inv.id, inv.siteId ?? "", inv.state, versionOf(inv), paidDate, cashAmount]);
    for (const a of allocations) lineRows.push([inv.id, a.line, a.part, a.month, a.category, a.amount, a.flag]);
  }
  await transaction(async (q) => {
    // One writer at a time (cron and a page-triggered sync can overlap).
    await q("SELECT pg_advisory_xact_lock($1)", [SYNC_LOCK_ID]);
    await q("DELETE FROM revenue_lines WHERE invoice_id = ANY($1)", [invoices.map((i) => i.id)]);
    await q(
      `INSERT INTO revenue_invoices (invoice_id, site_id, state, version, paid_date, cash_amount)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::date[], $6::numeric[])
       ON CONFLICT (invoice_id) DO UPDATE SET site_id = EXCLUDED.site_id, state = EXCLUDED.state, version = EXCLUDED.version,
         paid_date = EXCLUDED.paid_date, cash_amount = EXCLUDED.cash_amount, synced_at = now()`,
      columns(invRows, 6)
    );
    if (lineRows.length > 0) {
      await q(
        `INSERT INTO revenue_lines (invoice_id, line, part, month, category, amount, flag)
         SELECT * FROM UNNEST($1::text[], $2::int[], $3::int[], $4::text[], $5::text[], $6::numeric[], $7::text[])`,
        columns(lineRows, 7)
      );
    }
  });
}

// Row tuples → one array per column, for INSERT … SELECT FROM UNNEST.
function columns(rows: unknown[], n: number): unknown[][] {
  return Array.from({ length: n }, (_, c) => rows.map((r) => (r as unknown[])[c]));
}

// ---------------------------------------------------------------- report

// Invoice states that will never be paid — left out of "not paid yet".
const DEAD_STATES = /(cancel|void|draft|writ)/i;

export type CategoryTotals = Record<RevenueCategory, number>;
const emptyTotals = (): CategoryTotals => ({ rent: 0, lateFee: 0, item: 0, unclassified: 0 });
const sum = (t: CategoryTotals) => t.rent + t.lateFee + t.item + t.unclassified;

export type RevenueReport = {
  generatedAt: string;
  today: string;
  month: string;
  isCurrentMonth: boolean;
  sites: { id: string; name: string }[];
  site: string; // "all" or a site id
  totals: CategoryTotals;
  total: number;
  // Previous month, as it stood on the same day of that month when this is
  // the current month (pace), otherwise in full.
  comparison: { month: string; total: number; isPace: boolean; asOf: string | null };
  unpaid: { amount: number; invoices: number };
  deferred: number;
  trend: { month: string; totals: CategoryTotals; total: number; cash: number }[];
  bySite: { siteId: string; siteName: string; totals: CategoryTotals; total: number; comparison: number }[];
  checks: { qtyMismatch: number; rentNoPeriod: number; unclassified: { lines: number; amount: number } };
  sync: { lastRun: string | null; listed: number; pending: number; lastError: string | null; invoices: number };
};

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

// Same day of month, clamped to the shorter month (31 Mar → 28/29 Feb).
function sameDayIn(month: string, today: string): string {
  const last = lastDayOf(month);
  const day = Math.min(Number(today.slice(8, 10)), Number(last.slice(8, 10)));
  return `${month}-${String(day).padStart(2, "0")}`;
}

type Row = { month?: string; site_id?: string; category: RevenueCategory; amount: string };

function toTotals(rows: Row[]): CategoryTotals {
  const t = emptyTotals();
  for (const r of rows) t[r.category] += Number(r.amount);
  return t;
}

export async function getRevenueReport(monthParam: string, site: string): Promise<RevenueReport> {
  await ensureSchema();
  const today = jakartaToday();
  const current = today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(monthParam) && monthParam <= current ? monthParam : monthParam === "last" ? addMonths(current, -1) : current;
  const isCurrentMonth = month === current;
  const prev = addMonths(month, -1);
  const asOf = isCurrentMonth ? sameDayIn(prev, today) : null;
  const siteFilter = site === "all" ? null : site;
  const first = addMonths(month, -11);

  // $1 site (null = all)
  const paidLines = `FROM revenue_lines l JOIN revenue_invoices i USING (invoice_id)
    WHERE i.paid_date IS NOT NULL AND ($1::text IS NULL OR i.site_id = $1)`;

  const [monthRows, compRows, trendRows, cashRows, siteRows, siteCompRows, unpaidRows, deferredRows, flagRows, syncRows, sites] =
    await Promise.all([
      query<Row>(`SELECT l.category, SUM(l.amount) AS amount ${paidLines} AND l.month = $2 GROUP BY l.category`, [siteFilter, month]),
      query<Row>(
        `SELECT l.category, SUM(l.amount) AS amount ${paidLines} AND l.month = $2 AND ($3::date IS NULL OR i.paid_date <= $3) GROUP BY l.category`,
        [siteFilter, prev, asOf]
      ),
      query<Row>(
        `SELECT l.month, l.category, SUM(l.amount) AS amount ${paidLines} AND l.month BETWEEN $2 AND $3 GROUP BY l.month, l.category`,
        [siteFilter, first, month]
      ),
      query<{ month: string; amount: string }>(
        `SELECT to_char(paid_date, 'YYYY-MM') AS month, SUM(cash_amount) AS amount FROM revenue_invoices
         WHERE paid_date IS NOT NULL AND ($1::text IS NULL OR site_id = $1) AND to_char(paid_date, 'YYYY-MM') BETWEEN $2 AND $3
         GROUP BY 1`,
        [siteFilter, first, month]
      ),
      query<Row>(`SELECT i.site_id, l.category, SUM(l.amount) AS amount ${paidLines} AND l.month = $2 GROUP BY i.site_id, l.category`, [
        null,
        month,
      ]),
      query<{ site_id: string; amount: string }>(
        `SELECT i.site_id, SUM(l.amount) AS amount ${paidLines} AND l.month = $2 AND ($3::date IS NULL OR i.paid_date <= $3) GROUP BY i.site_id`,
        [null, prev, asOf]
      ),
      query<{ state: string; invoice_id: string; amount: string }>(
        `SELECT i.state, i.invoice_id, SUM(l.amount) AS amount FROM revenue_lines l JOIN revenue_invoices i USING (invoice_id)
         WHERE i.paid_date IS NULL AND l.category = 'rent' AND l.month = $2 AND ($1::text IS NULL OR i.site_id = $1)
         GROUP BY i.state, i.invoice_id`,
        [siteFilter, month]
      ),
      // Paid by the end of this month (today for the current one) for later months.
      query<{ amount: string | null }>(
        `SELECT SUM(l.amount) AS amount ${paidLines} AND l.month > $2 AND i.paid_date <= $3`,
        [siteFilter, month, isCurrentMonth ? today : lastDayOf(month)]
      ),
      query<{ flag: string | null; category: RevenueCategory; lines: string; amount: string }>(
        `SELECT l.flag, l.category, COUNT(*) AS lines, SUM(l.amount) AS amount ${paidLines} AND l.month = $2
           AND (l.flag IS NOT NULL OR l.category = 'unclassified') GROUP BY l.flag, l.category`,
        [siteFilter, month]
      ),
      query<{ last_run: string | null; listed: number | null; pending: number | null; last_error: string | null; invoices: string }>(
        `SELECT s.last_run, s.listed, s.pending, s.last_error, (SELECT COUNT(*) FROM revenue_invoices) AS invoices
         FROM (SELECT 1) x LEFT JOIN revenue_sync s ON s.id = 1`
      ),
      fetchSites(),
    ]);

  const totals = toTotals(monthRows);
  const unpaid = unpaidRows.filter((r) => !DEAD_STATES.test(r.state));
  const siteName = new Map(sites.map((s) => [s.id, pickTitle(s.title, s.code ?? s.id)]));
  const siteIds = Array.from(new Set(siteRows.map((r) => r.site_id!)));
  const sync = syncRows[0];

  return {
    generatedAt: new Date().toISOString(),
    today,
    month,
    isCurrentMonth,
    sites: sites.map((s) => ({ id: s.id, name: siteName.get(s.id)! })).sort((a, b) => a.name.localeCompare(b.name)),
    site: siteFilter ?? "all",
    totals,
    total: sum(totals),
    comparison: { month: prev, total: sum(toTotals(compRows)), isPace: isCurrentMonth, asOf },
    unpaid: { amount: unpaid.reduce((s, r) => s + Number(r.amount), 0), invoices: unpaid.length },
    deferred: Number(deferredRows[0]?.amount ?? 0),
    trend: Array.from({ length: 12 }, (_, i) => {
      const m = addMonths(first, i);
      const t = toTotals(trendRows.filter((r) => r.month === m));
      return { month: m, totals: t, total: sum(t), cash: Number(cashRows.find((r) => r.month === m)?.amount ?? 0) };
    }),
    bySite: siteIds
      .map((id) => {
        const t = toTotals(siteRows.filter((r) => r.site_id === id));
        return {
          siteId: id,
          siteName: siteName.get(id) ?? id,
          totals: t,
          total: sum(t),
          comparison: Number(siteCompRows.find((r) => r.site_id === id)?.amount ?? 0),
        };
      })
      .sort((a, b) => b.total - a.total),
    checks: {
      qtyMismatch: flagRows.filter((r) => r.flag === "qty_mismatch").reduce((s, r) => s + Number(r.lines), 0),
      rentNoPeriod: flagRows.filter((r) => r.flag === "rent_no_period").reduce((s, r) => s + Number(r.lines), 0),
      unclassified: {
        lines: flagRows.filter((r) => r.category === "unclassified").reduce((s, r) => s + Number(r.lines), 0),
        amount: flagRows.filter((r) => r.category === "unclassified").reduce((s, r) => s + Number(r.amount), 0),
      },
    },
    sync: {
      lastRun: sync?.last_run ? new Date(sync.last_run).toISOString() : null,
      listed: sync?.listed ?? 0,
      pending: sync?.pending ?? 0,
      lastError: sync?.last_error ?? null,
      invoices: Number(sync?.invoices ?? 0),
    },
  };
}
