import { fetchSites, fetchUnits, fetchUserById, paginate, pickTitle } from "./storeganise";

// SpaceHub-specific user custom field (type File, not a Storeganise default)
// holding the tenant's uploaded KTP/passport.
export const ID_CUSTOM_FIELD = "passport-ktp";

export type IdStatus = "present" | "missing" | "unknown";

export type IdCheckTenant = {
  ownerId: string;
  name: string;
  email?: string;
  phone?: string;
  siteNames: string[];
  unitNames: string[];
  status: IdStatus;
};

export type IdCheckSiteBreakdown = {
  siteId: string;
  siteName: string;
  totalTenants: number;
  withId: number;
  withoutId: number;
  unknown: number;
};

// Structure only — key names, counts, and value *types*. Never values.
export type IdCheckDiagnostics = {
  usersFetched: number;
  usersWithCustomFields: number;
  customFieldKeys: { key: string; records: number; nonEmpty: number; shapes: string[] }[];
};

export type IdCheckReport = {
  generatedAt: string;
  totalTenants: number;
  withId: number;
  withoutId: number;
  unknown: number;
  bySite: IdCheckSiteBreakdown[];
  // Only the tenants someone needs to act on — tenants who do have an ID are
  // counted but never listed.
  tenantsWithoutId: IdCheckTenant[];
  tenantsUnknown: IdCheckTenant[];
  diagnostics: IdCheckDiagnostics;
};

type OccupiedRental = {
  id: string;
  unitId: string;
  siteId: string;
  ownerId: string;
  owner?: { name?: string; email?: string; phone?: string };
};

// The File field's value shape isn't documented anywhere we could read — so
// "has an ID" means "has any non-empty value", whichever shape it is.
function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "array(empty)" : `array<${shapeOf(value[0])}>`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `object{${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",…" : ""}}`;
  }
  return typeof value;
}

const USER_FETCH_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function getIdCheckReport(): Promise<IdCheckReport> {
  const [sites, units, rentals] = await Promise.all([
    fetchSites(),
    fetchUnits(),
    paginate<OccupiedRental>("/v1/admin/unit-rentals?state=occupied&include=owner"),
  ]);

  const siteNameById = new Map(sites.map((s) => [s.id, pickTitle(s.title, s.code ?? s.id)]));
  const unitNameById = new Map(units.map((u) => [u.id, u.name ?? u.id]));

  // One tenant can rent several units (possibly across sites) — the report is
  // per tenant, not per unit.
  const byOwner = new Map<string, { rentals: OccupiedRental[]; owner: OccupiedRental["owner"] }>();
  for (const rental of rentals) {
    const entry = byOwner.get(rental.ownerId);
    if (entry) entry.rentals.push(rental);
    else byOwner.set(rental.ownerId, { rentals: [rental], owner: rental.owner });
  }

  const diag = { usersFetched: 0, usersWithCustomFields: 0 };
  const keyStats = new Map<string, { key: string; records: number; nonEmpty: number; shapes: Set<string> }>();

  const tenants = await mapWithConcurrency(Array.from(byOwner.entries()), USER_FETCH_CONCURRENCY, async ([ownerId, { rentals, owner }]) => {
    let status: IdStatus;
    let name = owner?.name;
    let email = owner?.email;
    let phone = owner?.phone;

    // Storeganise only returns a user's custom fields when explicitly asked
    // with include=customFields — neither the plain user record nor
    // unit-rentals?include=owner carries them (confirmed in production: 0 of
    // 285 tenants without it).
    try {
      const user = await fetchUserById(ownerId, { include: "customFields" });
      diag.usersFetched += 1;
      if (user.customFields) {
        diag.usersWithCustomFields += 1;
        for (const [key, value] of Object.entries(user.customFields)) {
          const s = keyStats.get(key) ?? { key, records: 0, nonEmpty: 0, shapes: new Set<string>() };
          keyStats.set(key, s);
          s.records += 1;
          if (hasValue(value)) s.nonEmpty += 1;
          s.shapes.add(shapeOf(value));
        }
      }
      status = hasValue(user.customFields?.[ID_CUSTOM_FIELD]) ? "present" : "missing";
      name ??= user.name;
      email ??= user.email;
      phone ??= user.phone;
    } catch {
      // A failed lookup is "unknown", never "missing" — we didn't see the
      // record, so we can't claim the ID isn't there.
      status = "unknown";
    }

    const tenant: IdCheckTenant = {
      ownerId,
      name: name ?? ownerId,
      email,
      phone,
      siteNames: Array.from(new Set(rentals.map((r) => siteNameById.get(r.siteId) ?? r.siteId))),
      unitNames: rentals.map((r) => unitNameById.get(r.unitId) ?? r.unitId),
      status,
    };
    return { tenant, siteIds: Array.from(new Set(rentals.map((r) => r.siteId))) };
  });

  const bySiteMap = new Map<string, IdCheckSiteBreakdown>();
  for (const { tenant, siteIds } of tenants) {
    for (const siteId of siteIds) {
      let entry = bySiteMap.get(siteId);
      if (!entry) {
        entry = { siteId, siteName: siteNameById.get(siteId) ?? siteId, totalTenants: 0, withId: 0, withoutId: 0, unknown: 0 };
        bySiteMap.set(siteId, entry);
      }
      entry.totalTenants += 1;
      if (tenant.status === "present") entry.withId += 1;
      else if (tenant.status === "missing") entry.withoutId += 1;
      else entry.unknown += 1;
    }
  }

  const all = tenants.map((t) => t.tenant);
  const byName = (a: IdCheckTenant, b: IdCheckTenant) => a.name.localeCompare(b.name);

  return {
    generatedAt: new Date().toISOString(),
    totalTenants: all.length,
    withId: all.filter((t) => t.status === "present").length,
    withoutId: all.filter((t) => t.status === "missing").length,
    unknown: all.filter((t) => t.status === "unknown").length,
    bySite: Array.from(bySiteMap.values()).sort((a, b) => a.siteName.localeCompare(b.siteName)),
    tenantsWithoutId: all.filter((t) => t.status === "missing").sort(byName),
    tenantsUnknown: all.filter((t) => t.status === "unknown").sort(byName),
    diagnostics: {
      ...diag,
      customFieldKeys: Array.from(keyStats.values())
        .map((s) => ({ ...s, shapes: Array.from(s.shapes) }))
        .sort((a, b) => b.records - a.records),
    },
  };
}
