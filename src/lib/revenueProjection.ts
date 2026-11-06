// Month-end projection for accrual revenue, as it will stand at finance's
// closing (the 5th of the next month).
//
// For a month and a day in it, everything comes from what invoices looked
// like on that same day in past months:
//   realized  paid by that day, for the month's periods
//   unpaid    issued by that day, not paid yet (never-to-be-paid states left out)
//   collected the part of `unpaid` that got paid before closing
//   final     the month's figure at closing
// collect rate c = Σ collected / Σ unpaid; covered share s = Σ (realized +
// collected) / Σ final. Projection = (realized + c × unpaid) / s.
// The range comes from running the same method on each past month with the
// other months' rates (leave-one-out): the largest misses up and down.

export const CLOSING_DAY = 5;
export const HISTORY_MONTHS = 12;
export const MIN_HISTORY = 3;

export type MonthPosition = { month: string; final: number; realized: number; unpaid: number; collected: number };

export type ProjectionResult = {
  value: number;
  low: number;
  high: number;
  realized: number;
  unpaid: number;
  collectRate: number;
  expectedFromUnpaid: number;
  share: number;
  rest: number;
  monthsUsed: number;
  meanAbsError: number;
  backtest: { month: string; projected: number; actual: number; error: number }[];
};

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

export function addDays(date: string, n: number): string {
  return new Date(utc(date) + n * 86_400_000).toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);

export const closingDateOf = (month: string) => `${addMonths(month, 1)}-${String(CLOSING_DAY).padStart(2, "0")}`;

function rates(history: MonthPosition[]): { collectRate: number; share: number } {
  const unpaid = history.reduce((s, h) => s + h.unpaid, 0);
  const final = history.reduce((s, h) => s + h.final, 0);
  return {
    // With no unpaid invoices on record at this point of the month, assume they get paid.
    collectRate: unpaid > 0 ? history.reduce((s, h) => s + h.collected, 0) / unpaid : 1,
    share: final > 0 ? history.reduce((s, h) => s + h.realized + h.collected, 0) / final : 0,
  };
}

export function projectMonth(current: { realized: number; unpaid: number }, history: MonthPosition[]): ProjectionResult | null {
  const hist = history.filter((h) => h.final > 0);
  if (hist.length < MIN_HISTORY) return null;
  const { collectRate, share } = rates(hist);
  if (share <= 0) return null;

  const expectedFromUnpaid = current.unpaid * collectRate;
  const value = (current.realized + expectedFromUnpaid) / share;

  const backtest = hist.map((h) => {
    const r = rates(hist.filter((x) => x !== h));
    const projected = r.share > 0 ? (h.realized + h.unpaid * r.collectRate) / r.share : 0;
    return { month: h.month, projected, actual: h.final, error: projected / h.final - 1 };
  });
  const errors = backtest.map((b) => b.error);
  // A projection that ran X% high in the past means the real figure may be
  // value / (1 + X); the range always contains the projection itself.
  const worstHigh = Math.max(0, ...errors);
  const worstLow = Math.max(-0.9, Math.min(0, ...errors));

  return {
    value,
    low: value / (1 + worstHigh),
    high: value / (1 + worstLow),
    realized: current.realized,
    unpaid: current.unpaid,
    collectRate,
    expectedFromUnpaid,
    share,
    rest: value - current.realized - expectedFromUnpaid,
    monthsUsed: hist.length,
    meanAbsError: errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length,
    backtest: backtest.sort((a, b) => b.month.localeCompare(a.month)),
  };
}
