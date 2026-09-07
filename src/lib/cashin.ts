import { fetchSites, paginate, pickTitle } from "./storeganise";

export type CashinCategory = "newRent" | "extension" | "lateFee" | "item" | "unclassified";

export const CASHIN_CATEGORIES: CashinCategory[] = ["newRent", "extension", "lateFee", "item", "unclassified"];

export type CashinTotals = Record<CashinCategory, number>;

function emptyTotals(): CashinTotals {
  return { newRent: 0, extension: 0, lateFee: 0, item: 0, unclassified: 0 };
}

export type CashinDayBreakdown = { date: string; totals: CashinTotals; total: number };
export type CashinSiteBreakdown = { siteId: string; siteName: string; totals: CashinTotals; total: number };

// One invoice line item that landed in "unclassified" — surfaced so a real person
// can look the invoice up in Storeganise (by `invoiceSid`) and judge whether the
// keyword list needs a new entry, rather than the number being a black box.
export type CashinUnclassifiedEntry = {
  invoiceSid: string;
  siteId: string;
  siteName: string;
  desc: string;
  amount: number;
  date: string;
};

export type CashinReport = {
  generatedAt: string;
  period: { start: string; end: string };
  totals: CashinTotals;
  total: number;
  // Security deposits collected this period — tracked separately and excluded from
  // `totals`/`total` entirely, because a deposit isn't revenue: it's a refundable
  // liability (one month's rent, collected from new tenants, owed back later).
  depositTotal: number;
  byDay: CashinDayBreakdown[];
  bySite: CashinSiteBreakdown[];
  skippedCategorization: boolean;
  // Distinct invoices referenced by payments in this period — the number the
  // MAX_INVOICES_TO_CATEGORIZE cap below actually applies to (not the count of
  // invoices in any given state/date filter in the Storeganise admin UI, which
  // is a different set: invoice creation/state date vs. payment date).
  uniqueInvoiceCount: number;
  unclassifiedEntries: CashinUnclassifiedEntry[];
};

type StoreganisePayment = {
  id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  invoice: {
    id: string;
    sid: string;
    siteId: string;
    unitRentalId: string;
  };
};

type StoreganiseInvoiceEntry = {
  id: string;
  desc?: string;
  amount: number;
  qty?: number;
  total: number;
  type: string;
};

type StoreganiseInvoiceWithEntries = {
  id: string;
  sid: string;
  siteId: string;
  unitRentalId: string;
  created: string;
  entries: StoreganiseInvoiceEntry[];
};

async function fetchPayments(start: string, end: string): Promise<StoreganisePayment[]> {
  return paginate<StoreganisePayment>(`/v1/admin/invoices/payments?start=${start}&end=${end}`);
}

// Storeganise's own docs warn `include=` "should only be used when loading ... a
// small list (< 50) of items" — so entries are fetched in batches, not all at once
// and not one request per invoice.
const INVOICE_BATCH_SIZE = 40;

async function fetchInvoicesWithEntries(invoiceIds: string[]): Promise<StoreganiseInvoiceWithEntries[]> {
  const results: StoreganiseInvoiceWithEntries[] = [];
  for (let i = 0; i < invoiceIds.length; i += INVOICE_BATCH_SIZE) {
    const batch = invoiceIds.slice(i, i + INVOICE_BATCH_SIZE);
    const page = await paginate<StoreganiseInvoiceWithEntries>(
      `/v1/admin/invoices?ids=${batch.join(",")}&include=entries`
    );
    results.push(...page);
  }
  return results;
}

// Storeganise has no field marking an invoice as a rental's first-ever invoice vs a
// later renewal — "New Rent" vs "Extension" is inferred entirely from invoice history:
// the earliest invoice ever raised for a unit-rental is that rental's New Rent invoice,
// everything after is an Extension. There's no bulk "invoices for these N rentals" filter
// (same one-unitRentalId-per-request constraint noted for the occupied-units invoice
// lookup elsewhere), so this is one request per unique rental referenced this period —
// acceptable since it's bounded by the month's transaction count, not the whole portfolio.
async function resolveFirstInvoicePerRental(rentalIds: string[]): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    rentalIds.map(async (rentalId): Promise<[string, string | null]> => {
      try {
        const history = await paginate<{ id: string; created: string }>(
          `/v1/admin/invoices?unitRentalId=${rentalId}`
        );
        if (history.length === 0) return [rentalId, null];
        const earliest = history.reduce((a, b) => (a.created < b.created ? a : b));
        return [rentalId, earliest.id];
      } catch {
        // Fail soft: unknown history never matches an invoice id below, so its
        // "Rent" entries fall to Extension (the more common case) rather than
        // guessing New Rent.
        return [rentalId, null];
      }
    })
  );
  return new Map(entries);
}

// Storeganise doesn't tag entries as "late fee" or "product purchase" either — both
// come through as ordinary `type: "revenue"` lines. Classification here is by keyword
// match on the free-text `desc` staff type in, confirmed against real Late Fee and
// Padlock invoice samples (case varies — "Padlock" vs "padlock" — hence lowercasing).
// Anything that matches nothing falls into "unclassified" rather than being guessed
// into a category, so an unrecognized description never silently misreports.
const LATE_FEE_KEYWORD = "late fee";
const NON_RENTAL_ITEM_KEYWORDS = [
  "padlock",
  "gembok",
  "tape measure",
  "meteran",
  "permanent marker",
  "spidol",
  "scissors",
  "gunting",
  "cutter",
  "big box",
  "medium box",
  "boks",
  "tape",
  "card member",
];

// The full set of buckets an entry can classify into — "deposit" is not one of the
// five public CashinCategory values because it isn't cash-in at all; it's tracked
// separately (see CashinReport.depositTotal) and never rolled into `totals`/`total`.
type ClassificationBucket = CashinCategory | "deposit";

function classifyEntry(entry: StoreganiseInvoiceEntry, isFirstInvoiceForRental: boolean): ClassificationBucket {
  const desc = (entry.desc ?? "").toLowerCase();
  // Real invoices show deposit entries as an ordinary `type: "revenue"` line with
  // desc "Deposit" — the structured `type: "deposit"` value documented by Storeganise
  // doesn't actually appear in practice, so desc is checked either way.
  if (entry.type === "deposit" || desc.includes("deposit")) return "deposit";
  if (desc.includes(LATE_FEE_KEYWORD)) return "lateFee";
  if (NON_RENTAL_ITEM_KEYWORDS.some((k) => desc.includes(k))) return "item";
  if (desc.includes("rent")) return isFirstInvoiceForRental ? "newRent" : "extension";
  return "unclassified";
}

// Above this many distinct invoices in the period, skip entry-level categorization
// rather than risk a slow request (each invoice needs its own rental-history lookup).
// Caveat: since this skips fetching entries entirely, it also can't tell deposits
// apart from real revenue, so the reported total in this fallback path may overstate
// cash-in by whatever deposit money came in that period — hasn't been exercised
// against real transaction volume yet, so this tradeoff hasn't come up in practice.
const MAX_INVOICES_TO_CATEGORIZE = 400;

export async function getCashinReport(start: string, end: string): Promise<CashinReport> {
  const [payments, sites] = await Promise.all([fetchPayments(start, end), fetchSites()]);
  const siteNameById = new Map(sites.map((s) => [s.id, pickTitle(s.title, s.code ?? s.id)]));
  let depositTotal = 0;

  const byDayMap = new Map<string, CashinTotals>();
  const bySiteMap = new Map<string, CashinTotals>();
  const touchSite = (siteId: string) => {
    if (!bySiteMap.has(siteId)) bySiteMap.set(siteId, emptyTotals());
    return bySiteMap.get(siteId)!;
  };
  const touchDay = (date: string) => {
    if (!byDayMap.has(date)) byDayMap.set(date, emptyTotals());
    return byDayMap.get(date)!;
  };

  const uniqueInvoiceIds = Array.from(new Set(payments.map((p) => p.invoice.id)));
  const unclassifiedEntries: CashinUnclassifiedEntry[] = [];

  if (uniqueInvoiceIds.length > MAX_INVOICES_TO_CATEGORIZE) {
    for (const payment of payments) {
      touchDay(payment.date).unclassified += payment.amount;
      touchSite(payment.invoice.siteId).unclassified += payment.amount;
    }
  } else {
    const invoices = await fetchInvoicesWithEntries(uniqueInvoiceIds);
    const invoiceById = new Map(invoices.map((inv) => [inv.id, inv]));
    const rentalIds = Array.from(new Set(invoices.map((inv) => inv.unitRentalId)));
    const firstInvoiceIdByRental = await resolveFirstInvoicePerRental(rentalIds);

    for (const payment of payments) {
      const dayTotals = touchDay(payment.date);
      const siteTotals = touchSite(payment.invoice.siteId);
      const invoice = invoiceById.get(payment.invoice.id);

      if (!invoice || invoice.entries.length === 0) {
        dayTotals.unclassified += payment.amount;
        siteTotals.unclassified += payment.amount;
        unclassifiedEntries.push({
          invoiceSid: invoice?.sid ?? payment.invoice.sid,
          siteId: payment.invoice.siteId,
          siteName: siteNameById.get(payment.invoice.siteId) ?? payment.invoice.siteId,
          desc: invoice ? "(invoice tanpa baris entry)" : "(detail invoice tidak ditemukan)",
          amount: payment.amount,
          date: payment.date,
        });
        continue;
      }

      const isFirst = firstInvoiceIdByRental.get(invoice.unitRentalId) === invoice.id;
      const entryTotalsByBucket: Record<ClassificationBucket, number> = { ...emptyTotals(), deposit: 0 };
      let entriesSum = 0;
      for (const entry of invoice.entries) {
        const category = classifyEntry(entry, isFirst);
        entryTotalsByBucket[category] += entry.total;
        entriesSum += entry.total;
        if (category === "unclassified" && entry.total > 0) {
          unclassifiedEntries.push({
            invoiceSid: invoice.sid,
            siteId: payment.invoice.siteId,
            siteName: siteNameById.get(payment.invoice.siteId) ?? payment.invoice.siteId,
            desc: entry.desc ?? "(tanpa deskripsi)",
            amount: entry.total,
            date: payment.date,
          });
        }
      }

      if (entriesSum <= 0) {
        dayTotals.unclassified += payment.amount;
        siteTotals.unclassified += payment.amount;
        continue;
      }

      // Allocate this payment across categories in proportion to the invoice's own
      // entry composition — needed because one payment can cover a mix of categories
      // (e.g. a single payment settling both a rent period and a late fee together).
      // The deposit's share is tracked separately and never added to day/site totals.
      for (const category of CASHIN_CATEGORIES) {
        const share = Math.round((entryTotalsByBucket[category] / entriesSum) * payment.amount);
        dayTotals[category] += share;
        siteTotals[category] += share;
      }
      depositTotal += Math.round((entryTotalsByBucket.deposit / entriesSum) * payment.amount);
    }
  }

  const totals = emptyTotals();
  for (const dayTotals of byDayMap.values()) {
    for (const category of CASHIN_CATEGORIES) totals[category] += dayTotals[category];
  }
  const total = CASHIN_CATEGORIES.reduce((sum, c) => sum + totals[c], 0);

  const byDay: CashinDayBreakdown[] = Array.from(byDayMap.entries())
    .map(([date, dayTotals]) => ({
      date,
      totals: dayTotals,
      total: CASHIN_CATEGORIES.reduce((s, c) => s + dayTotals[c], 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const bySite: CashinSiteBreakdown[] = Array.from(bySiteMap.entries())
    .map(([siteId, siteTotals]) => ({
      siteId,
      siteName: siteNameById.get(siteId) ?? siteId,
      totals: siteTotals,
      total: CASHIN_CATEGORIES.reduce((s, c) => s + siteTotals[c], 0),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    generatedAt: new Date().toISOString(),
    period: { start, end },
    totals,
    total,
    depositTotal,
    byDay,
    bySite,
    skippedCategorization: uniqueInvoiceIds.length > MAX_INVOICES_TO_CATEGORIZE,
    uniqueInvoiceCount: uniqueInvoiceIds.length,
    unclassifiedEntries,
  };
}

// --- date range helpers (Jakarta calendar day, matching src/lib/snapshots.ts) ---

function jakartaDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

export function jakartaTodayForCashin(): string {
  return jakartaDateString(new Date());
}

export function firstOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

// The comparison range for "pace vs same day last month": 1st of the previous month
// through the same day-of-month as `dateStr`, capped to that month's actual length
// (e.g. Mar 31 compares against Feb 28/29, not an invalid Feb 31).
export function sameDayLastMonthRange(dateStr: string): { start: string; end: string } {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  let year = Number(yearStr);
  let month = Number(monthStr); // 1-12, the current month
  const day = Number(dayStr);

  month -= 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }

  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cappedDay = Math.min(day, lastDayOfMonth);
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(cappedDay)}`,
  };
}
