const BASE_URL = process.env.STOREGANISE_BASE_URL ?? "https://spacehub.storeganise.com/api";

type UnitState = "archived" | "blocked" | "available" | "reserved" | "occupied";

export type StoreganiseSite = {
  id: string;
  title?: Record<string, string>;
  code?: string;
};

export type StoreganiseUnit = {
  id: string;
  siteId: string;
  name?: string;
  state: UnitState;
  blockedReason?: string;
};

export type StoreganiseUnitRental = {
  id: string;
  unitId: string;
  siteId: string;
  ownerId: string;
  state: string;
  created?: string;
  owner?: {
    email?: string;
    name?: string;
    phone?: string;
  };
};

export type StoreganiseInvoice = {
  id: string;
  sid: string;
  unitRentalId: string;
  state: string;
  startDate?: string;
  paid?: string;
};

export type SiteOccupancy = {
  siteId: string;
  siteName: string;
  totalUnits: number;
  occupiedUnits: number;
  availableUnits: number;
  reservedUnits: number;
  blockedUnits: number;
  archivedUnits: number;
  occupancyRate: number;
};

export type OccupancySnapshot = {
  generatedAt: string;
  overall: {
    totalUnits: number;
    occupiedUnits: number;
    occupancyRate: number;
  };
  sites: SiteOccupancy[];
};

function authHeaders(): HeadersInit {
  const apiKey = process.env.STOREGANISE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "STOREGANISE_API_KEY is not set. Create an API key in Storeganise under Settings > Developer and set it in your environment."
    );
  }
  return { Authorization: `ApiKey ${apiKey}` };
}

// Storeganise's list-endpoint response shape isn't confirmed from the docs alone
// (bare array vs. a wrapped { data: [...] } object) — handle both defensively.
function extractList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    for (const key of ["data", "results", "items"]) {
      const value = (json as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  throw new Error(`Unexpected Storeganise API response shape: ${JSON.stringify(json).slice(0, 200)}`);
}

async function paginate<T>(path: string): Promise<T[]> {
  const limit = 1000;
  const results: T[] = [];
  let offset = 0;

  for (;;) {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Storeganise API error ${res.status} for ${path}: ${await res.text()}`);
    }

    const page = extractList<T>(await res.json());
    results.push(...page);

    if (page.length < limit) break;
    offset += limit;
  }

  return results;
}

function pickTitle(title: Record<string, string> | undefined, fallback: string): string {
  if (!title) return fallback;
  return title.en ?? Object.values(title)[0] ?? fallback;
}

export async function fetchSites(): Promise<StoreganiseSite[]> {
  return paginate<StoreganiseSite>("/v1/admin/sites");
}

export async function fetchUnits(): Promise<StoreganiseUnit[]> {
  return paginate<StoreganiseUnit>("/v1/admin/units");
}

async function fetchRentalsWithOwner(state: "occupied" | "reserved"): Promise<StoreganiseUnitRental[]> {
  return paginate<StoreganiseUnitRental>(`/v1/admin/unit-rentals?state=${state}&include=owner`);
}

// Invoices don't support filtering by multiple unitRentalIds at once (only a single
// unitRentalId per request), so fetching one-by-one for every occupied unit doesn't scale.
// Instead, fetch every invoice created in a recent window and match them up client-side.
// Rentals are invoiced roughly monthly, so 60 days comfortably covers the latest invoice
// for any actively-occupied unit; a unit with nothing in this window just shows no invoice.
const RECENT_INVOICE_WINDOW_DAYS = 60;

async function fetchRecentInvoices(): Promise<StoreganiseInvoice[]> {
  const since = new Date();
  since.setDate(since.getDate() - RECENT_INVOICE_WINDOW_DAYS);
  const start = since.toISOString().slice(0, 10);
  return paginate<StoreganiseInvoice>(`/v1/admin/invoices?start=${start}`);
}

export async function getOccupancySnapshot(): Promise<OccupancySnapshot> {
  const [sites, units] = await Promise.all([fetchSites(), fetchUnits()]);

  const bySite = new Map<string, SiteOccupancy>();
  for (const site of sites) {
    bySite.set(site.id, {
      siteId: site.id,
      siteName: pickTitle(site.title, site.code ?? site.id),
      totalUnits: 0,
      occupiedUnits: 0,
      availableUnits: 0,
      reservedUnits: 0,
      blockedUnits: 0,
      archivedUnits: 0,
      occupancyRate: 0,
    });
  }

  for (const unit of units) {
    const entry = bySite.get(unit.siteId);
    if (!entry) continue;

    if (unit.state === "archived") {
      entry.archivedUnits += 1;
      continue;
    }

    entry.totalUnits += 1;
    if (unit.state === "occupied") entry.occupiedUnits += 1;
    else if (unit.state === "available") entry.availableUnits += 1;
    else if (unit.state === "reserved") entry.reservedUnits += 1;
    else if (unit.state === "blocked") entry.blockedUnits += 1;
  }

  for (const entry of bySite.values()) {
    entry.occupancyRate = entry.totalUnits > 0 ? (entry.occupiedUnits / entry.totalUnits) * 100 : 0;
  }

  const siteList = Array.from(bySite.values()).sort((a, b) => b.occupancyRate - a.occupancyRate);

  const overallTotal = siteList.reduce((sum, s) => sum + s.totalUnits, 0);
  const overallOccupied = siteList.reduce((sum, s) => sum + s.occupiedUnits, 0);

  return {
    generatedAt: new Date().toISOString(),
    overall: {
      totalUnits: overallTotal,
      occupiedUnits: overallOccupied,
      occupancyRate: overallTotal > 0 ? (overallOccupied / overallTotal) * 100 : 0,
    },
    sites: siteList,
  };
}

type NonArchivedState = Exclude<UnitState, "archived">;

export type LatestInvoice = {
  number: string;
  state: string;
  paidAt?: string;
};

export type UnitDetail = {
  id: string;
  name: string;
  siteId: string;
  siteName: string;
  state: UnitState;
  blockedReason?: string;
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  reservedAt?: string;
  latestInvoice?: LatestInvoice;
};

export type StatusBreakdown = {
  state: NonArchivedState;
  count: number;
  percentage: number;
};

export type UnitsDetail = {
  generatedAt: string;
  totalUnits: number;
  archivedUnits: number;
  breakdown: StatusBreakdown[];
  units: UnitDetail[];
};

const NON_ARCHIVED_STATES: NonArchivedState[] = ["available", "occupied", "reserved", "blocked"];

export async function getUnitsDetail(): Promise<UnitsDetail> {
  const [sites, units, occupiedRentals, reservedRentals, recentInvoices] = await Promise.all([
    fetchSites(),
    fetchUnits(),
    fetchRentalsWithOwner("occupied"),
    fetchRentalsWithOwner("reserved"),
    fetchRecentInvoices(),
  ]);

  const siteNameById = new Map(sites.map((s) => [s.id, pickTitle(s.title, s.code ?? s.id)]));

  const ownerByUnitId = new Map<string, NonNullable<StoreganiseUnitRental["owner"]>>();
  for (const rental of [...occupiedRentals, ...reservedRentals]) {
    if (rental.owner) ownerByUnitId.set(rental.unitId, rental.owner);
  }
  const rentalIdByUnitId = new Map(occupiedRentals.map((r) => [r.unitId, r.id]));
  const reservedAtByUnitId = new Map(reservedRentals.map((r) => [r.unitId, r.created]));

  const latestInvoiceByRentalId = new Map<string, StoreganiseInvoice>();
  for (const invoice of recentInvoices) {
    const current = latestInvoiceByRentalId.get(invoice.unitRentalId);
    if (!current || (invoice.startDate ?? "") > (current.startDate ?? "")) {
      latestInvoiceByRentalId.set(invoice.unitRentalId, invoice);
    }
  }

  const unitDetails: UnitDetail[] = units.map((unit) => {
    const rentalId = rentalIdByUnitId.get(unit.id);
    const invoice = rentalId ? latestInvoiceByRentalId.get(rentalId) : undefined;
    const owner =
      unit.state === "occupied" || unit.state === "reserved" ? ownerByUnitId.get(unit.id) : undefined;

    return {
      id: unit.id,
      name: unit.name ?? unit.id,
      siteId: unit.siteId,
      siteName: siteNameById.get(unit.siteId) ?? unit.siteId,
      state: unit.state,
      blockedReason: unit.state === "blocked" ? unit.blockedReason : undefined,
      ownerName: owner?.name,
      ownerPhone: owner?.phone,
      ownerEmail: owner?.email,
      reservedAt: unit.state === "reserved" ? reservedAtByUnitId.get(unit.id) : undefined,
      latestInvoice:
        unit.state === "occupied" && invoice
          ? { number: invoice.sid, state: invoice.state, paidAt: invoice.state === "paid" ? invoice.paid : undefined }
          : undefined,
    };
  });

  const archivedUnits = unitDetails.filter((u) => u.state === "archived").length;
  const nonArchived = unitDetails.filter((u) => u.state !== "archived");
  const totalUnits = nonArchived.length;

  const counts: Record<NonArchivedState, number> = { available: 0, occupied: 0, reserved: 0, blocked: 0 };
  for (const u of nonArchived) {
    counts[u.state as NonArchivedState] += 1;
  }

  const breakdown: StatusBreakdown[] = NON_ARCHIVED_STATES.map((state) => ({
    state,
    count: counts[state],
    percentage: totalUnits > 0 ? (counts[state] / totalUnits) * 100 : 0,
  }));

  return {
    generatedAt: new Date().toISOString(),
    totalUnits,
    archivedUnits,
    breakdown,
    units: unitDetails,
  };
}
