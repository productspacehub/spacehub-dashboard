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
  state: UnitState;
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
