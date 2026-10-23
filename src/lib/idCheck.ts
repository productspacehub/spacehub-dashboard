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

type Source = "rental" | "include" | "user";

// Structure only — key names, counts, and value *types*. Never values: this
// is shown on the page to find where the ID actually lives in the API
// response without opening Storeganise.
export type IdCheckDiagnostics = {
  matchedKeys: string[];
  rentals: number;
  rentalsWithCustomFields: number;
  ownersFromInclude: number;
  includeOwnersWithCustomFields: number;
  usersFetched: number;
  fetchedUsersWithCustomFields: number;
  customFieldKeys: { source: Source; key: string; records: number; nonEmpty: number; shapes: string[] }[];
  // Top-level property names of each object type, to spot custom fields
  // living under a different property name than `customFields`.
  topLevelKeys: { source: Source; keys: { key: string; records: number }[] }[];
  // Nested property paths (any depth up to 4) whose name looks ID-related.
  keywordPaths: { source: Source; path: string; records: number; shapes: string[] }[];
  // One-off request for a single user with `include=customFields`, made only
  // when nothing was found otherwise.
  includeCustomFieldsProbe?: { result: string; customFieldKeys: string[] };
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
  customFields?: CustomFields;
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

const KEYWORD = /custom|ktp|passport|ident|document|file|attach|secret|upload/i;
const MAX_PATH_DEPTH = 4;

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

class DiagnosticsCollector {
  matchedKeys = new Set<string>();
  counts = {
    rentals: 0,
    rentalsWithCustomFields: 0,
    ownersFromInclude: 0,
    includeOwnersWithCustomFields: 0,
    usersFetched: 0,
    fetchedUsersWithCustomFields: 0,
  };
  private cf = new Map<string, { source: Source; key: string; records: number; nonEmpty: number; shapes: Set<string> }>();
  private top = new Map<Source, Map<string, number>>();
  private paths = new Map<string, { source: Source; path: string; records: number; shapes: Set<string> }>();

  object(source: Source, obj: unknown) {
    if (!obj || typeof obj !== "object") return;
    const top = this.top.get(source) ?? new Map<string, number>();
    this.top.set(source, top);
    for (const key of Object.keys(obj)) top.set(key, (top.get(key) ?? 0) + 1);
    this.walk(source, obj, "", 0);
  }

  customFields(source: Source, customFields: CustomFields) {
    for (const [key, value] of Object.entries(customFields)) {
      const id = `${source}:${key}`;
      const s = this.cf.get(id) ?? { source, key, records: 0, nonEmpty: 0, shapes: new Set<string>() };
      this.cf.set(id, s);
      s.records += 1;
      if (hasValue(value)) s.nonEmpty += 1;
      s.shapes.add(shapeOf(value));
    }
  }

  private walk(source: Source, value: unknown, path: string, depth: number) {
    if (depth >= MAX_PATH_DEPTH || !value || typeof value !== "object") return;
    const target = Array.isArray(value) ? value[0] : value;
    if (!target || typeof target !== "object") return;
    const prefix = Array.isArray(value) ? `${path}[]` : path;
    for (const [key, child] of Object.entries(target)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      if (KEYWORD.test(key)) {
        const id = `${source}:${childPath}`;
        const s = this.paths.get(id) ?? { source, path: childPath, records: 0, shapes: new Set<string>() };
        this.paths.set(id, s);
        s.records += 1;
        s.shapes.add(shapeOf(child));
      }
      this.walk(source, child, childPath, depth + 1);
    }
  }

  result(): Omit<IdCheckDiagnostics, "includeCustomFieldsProbe"> {
    const order: Record<Source, number> = { rental: 0, include: 1, user: 2 };
    return {
      matchedKeys: Array.from(this.matchedKeys),
      ...this.counts,
      customFieldKeys: Array.from(this.cf.values())
        .map((s) => ({ ...s, shapes: Array.from(s.shapes) }))
        .sort((a, b) => order[a.source] - order[b.source] || b.records - a.records),
      topLevelKeys: Array.from(this.top.entries())
        .sort(([a], [b]) => order[a] - order[b])
        .map(([source, keys]) => ({
          source,
          keys: Array.from(keys.entries())
            .map(([key, records]) => ({ key, records }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        })),
      keywordPaths: Array.from(this.paths.values())
        .map((s) => ({ ...s, shapes: Array.from(s.shapes) }))
        .sort((a, b) => order[a.source] - order[b.source] || a.path.localeCompare(b.path))
        .slice(0, 60),
    };
  }
}

// Checks one customFields object for the ID key; records which key matched.
function checkCustomFields(diag: DiagnosticsCollector, customFields: CustomFields | undefined): "present" | "empty" | "absent" {
  const key = findIdKey(customFields);
  if (!key) return "absent";
  diag.matchedKeys.add(key);
  return hasValue(customFields![key]) ? "present" : "empty";
}

export async function getIdCheckReport(): Promise<IdCheckReport> {
  const [sites, units, rentals] = await Promise.all([
    fetchSites(),
    fetchUnits(),
    paginate<OccupiedRental>("/v1/admin/unit-rentals?state=occupied&include=owner"),
  ]);

  const siteNameById = new Map(sites.map((s) => [s.id, pickTitle(s.title, s.code ?? s.id)]));
  const unitNameById = new Map(units.map((u) => [u.id, u.name ?? u.id]));
  const diag = new DiagnosticsCollector();

  // One tenant can rent several units (possibly across sites) — the report is
  // per tenant, not per unit.
  const byOwner = new Map<string, { rentals: OccupiedRental[]; owner: OccupiedRental["owner"] }>();
  for (const rental of rentals) {
    diag.counts.rentals += 1;
    const { owner, ...rentalOnly } = rental;
    diag.object("rental", rentalOnly);
    if (rental.customFields) {
      diag.counts.rentalsWithCustomFields += 1;
      diag.customFields("rental", rental.customFields);
    }
    const entry = byOwner.get(rental.ownerId);
    if (entry) entry.rentals.push(rental);
    else byOwner.set(rental.ownerId, { rentals: [rental], owner });
  }

  const owners = Array.from(byOwner.entries());
  const tenants = await mapWithConcurrency(owners, USER_FETCH_CONCURRENCY, async ([ownerId, { rentals, owner }]) => {
    let name = owner?.name;
    let email = owner?.email;
    let phone = owner?.phone;

    if (owner) {
      diag.counts.ownersFromInclude += 1;
      diag.object("include", owner);
    }
    if (owner?.customFields) {
      diag.counts.includeOwnersWithCustomFields += 1;
      diag.customFields("include", owner.customFields);
    }

    // The field could be defined on the rental (collected at booking) or on
    // the user profile — Storeganise supports custom fields on both. A tenant
    // has an ID if any of their records carries a non-empty value.
    const rentalHit = rentals.some((r) => checkCustomFields(diag, r.customFields) === "present");
    const includeHit = checkCustomFields(diag, owner?.customFields) === "present";

    let status: IdStatus;
    if (rentalHit || includeHit) {
      status = "present";
    } else {
      // Nothing in hand says "present" — read the full user record before
      // concluding "missing", since an included owner can carry a partial
      // customFields (or none).
      try {
        const user = await fetchUserById(ownerId);
        diag.counts.usersFetched += 1;
        diag.object("user", user);
        if (user.customFields) {
          diag.counts.fetchedUsersWithCustomFields += 1;
          diag.customFields("user", user.customFields);
        }
        status = checkCustomFields(diag, user.customFields) === "present" ? "present" : "missing";
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
  const withId = all.filter((t) => t.status === "present").length;
  const byName = (a: IdCheckTenant, b: IdCheckTenant) => a.name.localeCompare(b.name);

  const diagnostics: IdCheckDiagnostics = diag.result();
  if (withId === 0 && diagnostics.matchedKeys.length === 0 && owners.length > 0) {
    try {
      const probe = await fetchUserById(owners[0][0], { include: "customFields" });
      diagnostics.includeCustomFieldsProbe = {
        result: probe.customFields ? "customFields ada di response" : "OK, tapi customFields tetap tidak ada",
        customFieldKeys: Object.keys(probe.customFields ?? {}),
      };
    } catch (err) {
      const status = err instanceof Error ? err.message.match(/error (\d{3})/)?.[1] : undefined;
      diagnostics.includeCustomFieldsProbe = { result: `ditolak API (HTTP ${status ?? "?"})`, customFieldKeys: [] };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalTenants: all.length,
    withId,
    withoutId: all.filter((t) => t.status === "missing").length,
    unknown: all.filter((t) => t.status === "unknown").length,
    bySite: Array.from(bySiteMap.values()).sort((a, b) => a.siteName.localeCompare(b.siteName)),
    tenantsWithoutId: all.filter((t) => t.status === "missing").sort(byName),
    tenantsUnknown: all.filter((t) => t.status === "unknown").sort(byName),
    diagnostics,
  };
}
