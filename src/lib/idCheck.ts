import { fetchSites, fetchUnits, fetchUserById, paginate, pickTitle } from "./storeganise";

// SpaceHub-specific custom field (not a Storeganise default) holding the
// tenant's uploaded KTP/passport file.
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
};

type OccupiedRental = {
  id: string;
  unitId: string;
  siteId: string;
  ownerId: string;
  owner?: { name?: string; email?: string; phone?: string; customFields?: Record<string, unknown> };
};

// The field's value shape (file object, array of files, URL string) isn't
// documented anywhere we could read — so "has an ID" means "has any non-empty
// value", which holds whichever of those shapes Storeganise uses.
function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function statusFrom(customFields: Record<string, unknown> | undefined): IdStatus {
  return hasValue(customFields?.[ID_CUSTOM_FIELD]) ? "present" : "missing";
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

  const owners = Array.from(byOwner.entries());
  const tenants = await mapWithConcurrency(owners, USER_FETCH_CONCURRENCY, async ([ownerId, { rentals, owner }]) => {
    let status: IdStatus;
    let name = owner?.name;
    let email = owner?.email;
    let phone = owner?.phone;

    // `include=owner` may or may not carry customFields — only fall back to a
    // per-user fetch when it doesn't, so the common case stays one request.
    if (owner?.customFields) {
      status = statusFrom(owner.customFields);
    } else {
      try {
        const user = await fetchUserById(ownerId);
        status = statusFrom(user.customFields);
        name ??= user.name;
        email ??= user.email;
        phone ??= user.phone;
      } catch {
        // A failed lookup is "unknown", never "missing" — we didn't see the
        // record, so we can't claim the ID isn't there.
        status = "unknown";
      }
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
  };
}
