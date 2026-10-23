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

// Structure only — key names, counts, and value *types*. Never values: this
// is shown on the page to debug a mismatch between the field name staff see
// in Storeganise admin and the key the API actually returns.
export type IdCheckDiagnostics = {
  matchedKeys: string[];
  ownersFromInclude: number;
  includeOwnersWithCustomFields: number;
  usersFetched: number;
  fetchedUsersWithCustomFields: number;
  customFieldKeys: { source: "include" | "user"; key: string; records: number; nonEmpty: number; shapes: string[] }[];
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

type CustomFields = Record<string, unknown>;

type OccupiedRental = {
  id: string;
  unitId: string;
  siteId: string;
  ownerId: string;
  owner?: { name?: string; email?: string; phone?: string; customFields?: CustomFields };
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

function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "array(empty)" : `array<${shapeOf(value[0])}>`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `object{${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",…" : ""}}`;
  }
  return typeof value;
}

// The admin UI label and the API key can differ in separators/case
// ("passport-ktp" vs "passport_ktp" / "passportKtp"), so match loosely.
const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const TARGET_KEY = normalizeKey(ID_CUSTOM_FIELD);

function findIdKey(customFields: CustomFields | undefined): string | undefined {
  if (!customFields) return undefined;
  if (ID_CUSTOM_FIELD in customFields) return ID_CUSTOM_FIELD;
  return Object.keys(customFields).find((k) => normalizeKey(k) === TARGET_KEY);
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

  const keyStats = new Map<string, { source: "include" | "user"; key: string; records: number; nonEmpty: number; shapes: Set<string> }>();
  const matchedKeys = new Set<string>();
  const diag = { ownersFromInclude: 0, includeOwnersWithCustomFields: 0, usersFetched: 0, fetchedUsersWithCustomFields: 0 };

  const record = (source: "include" | "user", customFields: CustomFields) => {
    for (const [key, value] of Object.entries(customFields)) {
      const id = `${source}:${key}`;
      let s = keyStats.get(id);
      if (!s) {
        s = { source, key, records: 0, nonEmpty: 0, shapes: new Set() };
        keyStats.set(id, s);
      }
      s.records += 1;
      if (hasValue(value)) s.nonEmpty += 1;
      s.shapes.add(shapeOf(value));
    }
  };

  const owners = Array.from(byOwner.entries());
  const tenants = await mapWithConcurrency(owners, USER_FETCH_CONCURRENCY, async ([ownerId, { rentals, owner }]) => {
    let status: IdStatus;
    let name = owner?.name;
    let email = owner?.email;
    let phone = owner?.phone;

    if (owner) diag.ownersFromInclude += 1;
    if (owner?.customFields) {
      diag.includeOwnersWithCustomFields += 1;
      record("include", owner.customFields);
    }

    // Only trust `include=owner` when it actually carries the ID key — an
    // included owner can come back with a partial customFields object, which
    // would otherwise make every tenant read as "missing". Anything short of
    // that falls back to the full user record.
    const includeKey = findIdKey(owner?.customFields);
    if (includeKey) {
      matchedKeys.add(includeKey);
      status = hasValue(owner!.customFields![includeKey]) ? "present" : "missing";
    } else {
      try {
        const user = await fetchUserById(ownerId);
        diag.usersFetched += 1;
        if (user.customFields) {
          diag.fetchedUsersWithCustomFields += 1;
          record("user", user.customFields);
        }
        const userKey = findIdKey(user.customFields);
        if (userKey) matchedKeys.add(userKey);
        status = userKey && hasValue(user.customFields![userKey]) ? "present" : "missing";
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
    diagnostics: {
      matchedKeys: Array.from(matchedKeys),
      ...diag,
      customFieldKeys: Array.from(keyStats.values())
        .map((s) => ({ ...s, shapes: Array.from(s.shapes) }))
        .sort((a, b) => a.source.localeCompare(b.source) || b.records - a.records),
    },
  };
}
