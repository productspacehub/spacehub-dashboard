import { fetchSites, paginate, pickTitle } from "./storeganise";
import { MAX_INVOICES_TO_CATEGORIZE, fetchPayments, resolveFirstInvoicePerRental } from "./cashin";

export type MoveActivityTotals = { moveIn: number; moveOut: number; extend: number; net: number };

function emptyTotals(): MoveActivityTotals {
  return { moveIn: 0, moveOut: 0, extend: 0, net: 0 };
}

export type MoveActivityDayBreakdown = { date: string; moveIn: number; moveOut: number; extend: number };
export type MoveActivitySiteBreakdown = {
  siteId: string;
  siteName: string;
  moveIn: number;
  moveOut: number;
  extend: number;
  net: number;
};

export type MoveActivityReport = {
  generatedAt: string;
  period: { start: string; end: string };
  totals: MoveActivityTotals;
  byDay: MoveActivityDayBreakdown[];
  bySite: MoveActivitySiteBreakdown[];
  // Extend needs the same per-rental invoice-history lookup as Cash-in's New
  // Rent vs Extension split — skipped above MAX_INVOICES_TO_CATEGORIZE unique
  // invoices for the period, same fail-soft tradeoff as Cash-in (Extend is
  // reported as 0 rather than an expensive or guessed number).
  skippedExtendCategorization: boolean;
};

type UnitRentalDate = {
  id: string;
  siteId: string;
  state: string;
  startDate?: string;
  endDate?: string;
};

// A rental whose startDate has already passed (which is always true for the
// past/current periods this report queries) is treated as a real move-in
// unless it never actually happened — submitted (still pending) or cancelled/
// abandoned before move-in. Every other state (reserved onward) means the
// rental proceeded.
const MOVE_IN_NON_STATES = new Set(["submitted", "cancelled", "abandoned"]);

async function fetchMoveIns(start: string, end: string): Promise<UnitRentalDate[]> {
  const rentals = await paginate<UnitRentalDate>(`/v1/admin/unit-rentals?start=${start},${end}`);
  return rentals.filter((r) => !MOVE_IN_NON_STATES.has(r.state));
}

// Unlike Move In (inferred from a rental's own start date), Move Out has a
// direct structured source: Storeganise's own "ended" state plus its endDate —
// this replaces the previous approach (Move In count minus the day's occupancy
// change), which is fragile to same-day move-out+move-in pairs and snapshot
// timing. Not yet validated against real production numbers — see the
// methodology note on the /move-activity page.
async function fetchMoveOuts(start: string, end: string): Promise<UnitRentalDate[]> {
  return paginate<UnitRentalDate>(`/v1/admin/unit-rentals?state=ended&end=${start},${end}`);
}

export async function getMoveActivityReport(start: string, end: string): Promise<MoveActivityReport> {
  const [sites, moveIns, moveOuts, payments] = await Promise.all([
    fetchSites(),
    fetchMoveIns(start, end),
    fetchMoveOuts(start, end),
    fetchPayments(start, end),
  ]);
  const siteNameById = new Map(sites.map((s) => [s.id, pickTitle(s.title, s.code ?? s.id)]));

  const byDayMap = new Map<string, MoveActivityTotals>();
  const bySiteMap = new Map<string, MoveActivityTotals>();
  const touchDay = (date: string) => {
    if (!byDayMap.has(date)) byDayMap.set(date, emptyTotals());
    return byDayMap.get(date)!;
  };
  const touchSite = (siteId: string) => {
    if (!bySiteMap.has(siteId)) bySiteMap.set(siteId, emptyTotals());
    return bySiteMap.get(siteId)!;
  };

  for (const rental of moveIns) {
    if (!rental.startDate) continue;
    touchDay(rental.startDate).moveIn += 1;
    touchSite(rental.siteId).moveIn += 1;
  }
  for (const rental of moveOuts) {
    if (!rental.endDate) continue;
    touchDay(rental.endDate).moveOut += 1;
    touchSite(rental.siteId).moveOut += 1;
  }

  // Extend = invoices paid this period that are NOT the rental's first-ever
  // invoice (an existing tenant paying to continue, not a new move-in) — same
  // definition as Cash-in's "Extension" category, counted per invoice instead
  // of summed as revenue. `payment.invoice` already carries unitRentalId, so
  // (unlike Cash-in) no separate invoice/entries fetch is needed here.
  const uniqueInvoiceIds = Array.from(new Set(payments.map((p) => p.invoice.id)));
  const skippedExtendCategorization = uniqueInvoiceIds.length > MAX_INVOICES_TO_CATEGORIZE;

  if (!skippedExtendCategorization) {
    const rentalIds = Array.from(new Set(payments.map((p) => p.invoice.unitRentalId)));
    const firstInvoiceIdByRental = await resolveFirstInvoicePerRental(rentalIds);

    // One invoice can appear in multiple payments (e.g. a split payment) — count
    // each extend invoice once per day it was actually paid on, not once per payment.
    const countedPerDay = new Set<string>();
    for (const payment of payments) {
      const isFirst = firstInvoiceIdByRental.get(payment.invoice.unitRentalId) === payment.invoice.id;
      if (isFirst) continue;
      const key = `${payment.date}:${payment.invoice.id}`;
      if (countedPerDay.has(key)) continue;
      countedPerDay.add(key);
      touchDay(payment.date).extend += 1;
      touchSite(payment.invoice.siteId).extend += 1;
    }
  }

  for (const dayTotals of byDayMap.values()) dayTotals.net = dayTotals.moveIn - dayTotals.moveOut;
  for (const siteTotals of bySiteMap.values()) siteTotals.net = siteTotals.moveIn - siteTotals.moveOut;

  const totals = emptyTotals();
  for (const dayTotals of byDayMap.values()) {
    totals.moveIn += dayTotals.moveIn;
    totals.moveOut += dayTotals.moveOut;
    totals.extend += dayTotals.extend;
  }
  totals.net = totals.moveIn - totals.moveOut;

  const byDay: MoveActivityDayBreakdown[] = Array.from(byDayMap.entries())
    .map(([date, t]) => ({ date, moveIn: t.moveIn, moveOut: t.moveOut, extend: t.extend }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const bySite: MoveActivitySiteBreakdown[] = Array.from(bySiteMap.entries())
    .map(([siteId, t]) => ({
      siteId,
      siteName: siteNameById.get(siteId) ?? siteId,
      moveIn: t.moveIn,
      moveOut: t.moveOut,
      extend: t.extend,
      net: t.net,
    }))
    .sort((a, b) => b.extend - a.extend);

  return {
    generatedAt: new Date().toISOString(),
    period: { start, end },
    totals,
    byDay,
    bySite,
    skippedExtendCategorization,
  };
}
