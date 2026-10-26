import { createHash } from "node:crypto";
import { matchAddress, type AddressLevel, type AddressMatch } from "./addressMatch";
import { ensureSchema, query } from "./db";
import { normalize } from "./normalize";
import { loadRegionIndex, regencyLabel, shortProvince, shortRegency, type RegionIndex } from "./regions";
import { fetchTenantAddresses } from "./tenantAddresses";

export type TargetKind = "district" | "regency" | "province" | "foreign" | "unmappable";
export type MappingTarget = { kind: TargetKind; code: string | null };
export type Rule = MappingTarget & { id: number; phrase: string; createdBy: string; createdAt: string };
type Override = MappingTarget & { createdBy: string; createdAt: string };
export type Mappings = { overrides: Map<string, Override>; rules: Rule[] };
export type MappingSource = "auto" | "rule" | "override";
export type ResolvedAddress = { match: AddressMatch; source: MappingSource; ruleId?: number };

// Exact-email allowlist on top of dashboard login: this feature shows full
// addresses, unlike the aggregate-only profile.
export function isMappingAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return (process.env.ADDRESS_MAPPING_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export function addressHash(text: string): string {
  return createHash("sha256").update(normalize(text)).digest("hex");
}

const DETAIL: Record<AddressLevel, number> = { empty: 0, unrecognized: 1, foreign: 1, province: 2, regency: 3, district: 4 };
const TARGET_DETAIL: Record<TargetKind, number> = { unmappable: 1, foreign: 1, province: 2, regency: 3, district: 4 };

// Single words that name a kind of building or a direction, not a place —
// a rule on one of these alone would map unrelated addresses.
const GENERIC_WORDS = new Set([
  "tower", "towers", "apartemen", "apartement", "apartment", "apt", "taman", "residence", "residences", "residen",
  "city", "park", "garden", "gardens", "mall", "plaza", "office", "perumahan", "perum", "komplek", "kompleks",
  "cluster", "blok", "lantai", "unit", "raya", "jalan", "jl", "indah", "jaya", "baru", "utara", "selatan", "barat",
  "timur", "tengah", "square", "village", "hills", "kota", "rumah", "gedung", "graha", "wisma", "the",
]);

export function validateTarget(target: MappingTarget, index: RegionIndex, allowUnmappable: boolean): string | null {
  switch (target.kind) {
    case "district":
      return target.code && index.districts.has(target.code) ? null : "Kecamatan tidak dikenal";
    case "regency":
      return target.code && index.regencies.has(target.code) ? null : "Kota/kabupaten tidak dikenal";
    case "province":
      return target.code && index.provinces.has(target.code) ? null : "Provinsi tidak dikenal";
    case "foreign":
      return target.code === null ? null : "Kode tidak dipakai untuk luar negeri";
    case "unmappable":
      return allowUnmappable && target.code === null ? null : "Tidak bisa dipakai untuk aturan";
    default:
      return "Jenis wilayah tidak valid";
  }
}

export function validatePhrase(raw: string): { phrase: string } | { error: string } {
  const phrase = normalize(raw);
  if (phrase.length < 4) return { error: "Frasa terlalu pendek (minimal 4 karakter)" };
  if (/^[\d ]+$/.test(phrase)) return { error: "Frasa tidak boleh hanya angka" };
  if (!phrase.includes(" ") && GENERIC_WORDS.has(phrase)) {
    return { error: `"${phrase}" terlalu umum — tambahkan nama gedung/area-nya (mis. "taman rasuna")` };
  }
  return { phrase };
}

function regencyOfTarget(target: MappingTarget, index: RegionIndex): string | null {
  if (target.kind === "district") return index.districts.get(target.code!)!.regencyCode;
  if (target.kind === "regency") return target.code;
  return null;
}

function provinceOfTarget(target: MappingTarget, index: RegionIndex): string | null {
  const regency = regencyOfTarget(target, index);
  if (regency) return index.regencies.get(regency)!.provinceCode;
  return target.kind === "province" ? target.code : null;
}

function asMatch(target: MappingTarget, base: AddressMatch, index: RegionIndex): AddressMatch {
  const regency = regencyOfTarget(target, index);
  const level: AddressLevel = target.kind === "unmappable" ? "unrecognized" : target.kind;
  return {
    ...base,
    level,
    provinceCode: provinceOfTarget(target, index),
    regencyCodes: regency ? [regency] : [],
    districtCode: target.kind === "district" ? target.code : null,
    provinceConflict: false,
    leftoverWords: [],
  };
}

// A rule only ever adds detail the automatic match didn't have, and never
// contradicts what it did find: "Taman Rasuna, Jakarta Selatan" can go from
// city to kecamatan via a rule, but a rule can't move it to Bandung.
function ruleApplies(rule: Rule, auto: AddressMatch, index: RegionIndex): boolean {
  // "Luar negeri" sits at the same detail as "tidak dikenali", so it's its
  // own case: only for addresses nothing Indonesian was found in.
  if (rule.kind === "foreign") return auto.level === "unrecognized";
  const ambiguous = auto.level === "regency" && auto.regencyCodes.length > 1;
  const addsDetail = TARGET_DETAIL[rule.kind] > DETAIL[auto.level] || (ambiguous && TARGET_DETAIL[rule.kind] >= DETAIL.regency);
  if (!addsDetail) return false;
  if (auto.provinceCode && provinceOfTarget(rule, index) !== auto.provinceCode) return false;
  if (auto.regencyCodes.length > 0 && !auto.regencyCodes.includes(regencyOfTarget(rule, index) ?? "")) return false;
  return true;
}

export function resolveAddress(text: string, index: RegionIndex, mappings: Mappings | null): ResolvedAddress {
  const auto = matchAddress(text, index);
  if (auto.level === "empty" || !mappings) return { match: auto, source: "auto" };
  const override = mappings.overrides.get(addressHash(text));
  if (override) return { match: asMatch(override, auto, index), source: "override" };
  const padded = ` ${normalize(text)} `;
  const rule = mappings.rules
    .filter((r) => padded.includes(` ${r.phrase} `) && ruleApplies(r, auto, index))
    .sort((a, b) => b.phrase.length - a.phrase.length)[0];
  if (rule) return { match: asMatch(rule, auto, index), source: "rule", ruleId: rule.id };
  return { match: auto, source: "auto" };
}

type OverrideRow = { address_hash: string; target_kind: TargetKind; target_code: string | null; created_by: string; created_at: string };
type RuleRow = { id: number; phrase: string; target_kind: TargetKind; target_code: string | null; created_by: string; created_at: string };

export async function loadMappings(): Promise<Mappings> {
  await ensureSchema();
  const [overrides, rules] = await Promise.all([
    query<OverrideRow>("SELECT address_hash, target_kind, target_code, created_by, created_at FROM address_overrides"),
    query<RuleRow>("SELECT id, phrase, target_kind, target_code, created_by, created_at FROM address_rules ORDER BY phrase"),
  ]);
  return {
    overrides: new Map(
      overrides.map((o) => [
        o.address_hash,
        { kind: o.target_kind, code: o.target_code, createdBy: o.created_by, createdAt: new Date(o.created_at).toISOString() },
      ])
    ),
    rules: rules.map((r) => ({
      id: r.id,
      phrase: r.phrase,
      kind: r.target_kind,
      code: r.target_code,
      createdBy: r.created_by,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

export async function setOverride(hash: string, target: MappingTarget, by: string): Promise<void> {
  await ensureSchema();
  await query(
    `INSERT INTO address_overrides (address_hash, target_kind, target_code, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (address_hash) DO UPDATE SET target_kind = $2, target_code = $3, created_by = $4, created_at = now()`,
    [hash, target.kind, target.code, by]
  );
}

export async function deleteOverride(hash: string): Promise<boolean> {
  await ensureSchema();
  return (await query("DELETE FROM address_overrides WHERE address_hash = $1 RETURNING address_hash", [hash])).length > 0;
}

// Never silently repoints an existing rule — that would move every address it
// already covers. Saving the same phrase → same region again is a no-op.
export async function addRule(
  phrase: string,
  target: MappingTarget,
  by: string,
  index: RegionIndex
): Promise<{ ok: true } | { conflict: string }> {
  await ensureSchema();
  const inserted = await query(
    `INSERT INTO address_rules (phrase, target_kind, target_code, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (phrase) DO NOTHING
     RETURNING id`,
    [phrase, target.kind, target.code, by]
  );
  if (inserted.length > 0) return { ok: true };
  const [existing] = await query<{ target_kind: TargetKind; target_code: string | null }>(
    "SELECT target_kind, target_code FROM address_rules WHERE phrase = $1",
    [phrase]
  );
  if (existing && existing.target_kind === target.kind && existing.target_code === target.code) return { ok: true };
  const label = existing ? targetLabel({ kind: existing.target_kind, code: existing.target_code }, index) : "wilayah lain";
  return { conflict: `Frasa "${phrase}" sudah punya aturan → ${label}. Hapus aturan itu dulu kalau ingin menggantinya.` };
}

export async function deleteRule(id: number): Promise<boolean> {
  await ensureSchema();
  return (await query("DELETE FROM address_rules WHERE id = $1 RETURNING id", [id])).length > 0;
}

export function targetLabel(target: MappingTarget, index: RegionIndex): string {
  switch (target.kind) {
    case "district": {
      const d = index.districts.get(target.code!)!;
      return `Kec. ${d.name}, ${shortRegency(index.regencies.get(d.regencyCode)!.name)}`;
    }
    case "regency":
      return shortRegency(index.regencies.get(target.code!)!.name);
    case "province":
      return shortProvince(index.provinces.get(target.code!)!.name);
    case "foreign":
      return "Luar negeri";
    case "unmappable":
      return "Tidak bisa dipetakan";
  }
}

export type RegionOption = { kind: "district" | "regency" | "province"; code: string; label: string; sublabel: string };

export function searchRegions(q: string, index: RegionIndex, limit = 20): RegionOption[] {
  const nq = normalize(q);
  if (nq.length < 2) return [];
  const score = (name: string): number | null => {
    const n = normalize(name);
    if (n === nq) return 0;
    if (n.startsWith(nq)) return 1;
    if (n.includes(` ${nq}`)) return 2;
    if (n.includes(nq)) return 3;
    return null;
  };
  const found: (RegionOption & { score: number; order: number })[] = [];
  for (const p of index.provinces.values()) {
    const s = Math.min(score(p.name) ?? 9, score(shortProvince(p.name)) ?? 9);
    if (s < 9) found.push({ kind: "province", code: p.code, label: shortProvince(p.name), sublabel: "Provinsi", score: s, order: 0 });
  }
  for (const r of index.regencies.values()) {
    const bare = r.name.replace(/^(Kabupaten Administrasi|Kota Administrasi|Kabupaten|Kota)\s+/, "");
    const s = Math.min(score(r.name) ?? 9, score(bare) ?? 9);
    if (s < 9) {
      found.push({
        kind: "regency",
        code: r.code,
        label: shortRegency(r.name),
        sublabel: shortProvince(index.provinces.get(r.provinceCode)!.name),
        score: s,
        order: 1,
      });
    }
  }
  for (const d of index.districts.values()) {
    const s = score(d.name);
    if (s !== null) {
      const regency = index.regencies.get(d.regencyCode)!;
      found.push({
        kind: "district",
        code: d.code,
        label: `Kec. ${d.name}`,
        sublabel: `${shortRegency(regency.name)}, ${shortProvince(index.provinces.get(regency.provinceCode)!.name)}`,
        score: s,
        order: 2,
      });
    }
  }
  return found
    .sort((a, b) => a.score - b.score || a.order - b.order || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ kind, code, label, sublabel }) => ({ kind, code, label, sublabel }));
}

export type QueueItem = {
  hash: string;
  text: string;
  tenants: number;
  autoLabel: string;
  autoLevel: AddressLevel;
  ambiguous: boolean;
};

export type MappingOverview = {
  generatedAt: string;
  queue: QueueItem[];
  overridden: { hash: string; text: string; tenants: number; label: string; createdBy: string; createdAt: string }[];
  orphanOverrides: number;
  rules: { id: number; phrase: string; label: string; addresses: number; tenants: number; createdBy: string; createdAt: string }[];
};

function autoLabel(m: AddressMatch, index: RegionIndex): string {
  switch (m.level) {
    case "regency":
      return `Ambigu: ${regencyLabel(m.regencyCodes, index)}`;
    case "province":
      return `Hanya provinsi: ${shortProvince(index.provinces.get(m.provinceCode!)!.name)}`;
    case "foreign":
      return "Kemungkinan luar negeri";
    default:
      return "Tidak dikenali";
  }
}

// Full address text is in here — only for the restricted mapping page.
export async function getMappingOverview(): Promise<MappingOverview> {
  const [index, { addresses }, mappings] = await Promise.all([loadRegionIndex(), fetchTenantAddresses(), loadMappings()]);

  // Identical addresses (after normalizing) are one item: map once, done.
  const groups = new Map<string, { text: string; tenants: number }>();
  for (const text of addresses) {
    if (!normalize(text)) continue;
    const hash = addressHash(text);
    const g = groups.get(hash);
    if (g) g.tenants += 1;
    else groups.set(hash, { text: text.trim(), tenants: 1 });
  }

  const queue: QueueItem[] = [];
  const overridden: MappingOverview["overridden"] = [];
  const ruleUse = new Map<number, { addresses: number; tenants: number }>();
  for (const [hash, g] of groups) {
    const r = resolveAddress(g.text, index, mappings);
    if (r.source === "override") {
      const o = mappings.overrides.get(hash)!;
      overridden.push({ hash, text: g.text, tenants: g.tenants, label: targetLabel(o, index), createdBy: o.createdBy, createdAt: o.createdAt });
    } else if (r.source === "rule") {
      const u = ruleUse.get(r.ruleId!) ?? { addresses: 0, tenants: 0 };
      u.addresses += 1;
      u.tenants += g.tenants;
      ruleUse.set(r.ruleId!, u);
    } else {
      const ambiguous = r.match.level === "regency" && r.match.regencyCodes.length > 1;
      if (DETAIL[r.match.level] < DETAIL.regency || ambiguous) {
        queue.push({ hash, text: g.text, tenants: g.tenants, autoLabel: autoLabel(r.match, index), autoLevel: r.match.level, ambiguous });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    queue: queue.sort((a, b) => b.tenants - a.tenants || a.text.localeCompare(b.text)),
    overridden: overridden.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    orphanOverrides: Array.from(mappings.overrides.keys()).filter((h) => !groups.has(h)).length,
    rules: mappings.rules.map((rule) => ({
      id: rule.id,
      phrase: rule.phrase,
      label: targetLabel(rule, index),
      ...(ruleUse.get(rule.id) ?? { addresses: 0, tenants: 0 }),
      createdBy: rule.createdBy,
      createdAt: rule.createdAt,
    })),
  };
}
