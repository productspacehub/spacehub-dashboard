import type { AddressLevel } from "./addressMatch";
import { loadMappings, resolveAddress } from "./addressMapping";
import { loadRegionIndex, regencyLabel, shortProvince } from "./regions";
import { fetchTenantAddresses } from "./tenantAddresses";

// Words/areas below these counts are left out so no individual tenant can be
// picked out from the profile.
export const WORD_MIN_ADDRESSES = 5;
export const DISTRICT_MIN_TENANTS = 3;
const TOP_WORDS = 30;

export const ADDRESS_LEVELS: AddressLevel[] = ["district", "regency", "province", "foreign", "unrecognized", "empty"];

export type WordCount = { word: string; addresses: number };

// Aggregates only — never an address or a tenant name.
export type AddressProfile = {
  generatedAt: string;
  totalTenants: number;
  byLevel: Record<AddressLevel, number>;
  ambiguousRegency: number;
  provinceConflicts: number;
  veryShort: { total: number; byLevel: Record<AddressLevel, number> };
  withPostalCode: number;
  nonTextAddresses: number;
  provinces: { name: string; count: number }[];
  regencies: { label: string; provinceName: string; count: number; ambiguous: boolean }[];
  districts: { name: string; regencyLabel: string; count: number }[];
  districtsHidden: { areas: number; tenants: number };
  words: { unrecognized: WordCount[]; provinceOnly: WordCount[] };
  // Manual mappings applied on top of automatic matching; available=false
  // when they couldn't be loaded (the profile then shows automatic only).
  mapping: { available: boolean; manual: number; rule: number };
};

// Structural words that say nothing about where someone lives.
const STOPWORDS = new Set([
  "jl", "jln", "jalan", "no", "nomor", "nmr", "rt", "rw", "blok", "blk", "kav", "kavling", "km", "gg", "gang",
  "kel", "kelurahan", "kec", "kecamatan", "desa", "dusun", "kota", "kab", "kabupaten", "prov", "provinsi",
  "indonesia", "dan", "lantai", "unit", "the", "and", "raya",
]);

function emptyLevels(): Record<AddressLevel, number> {
  return { district: 0, regency: 0, province: 0, foreign: 0, unrecognized: 0, empty: 0 };
}

function topWords(counts: Map<string, number>): WordCount[] {
  return Array.from(counts.entries())
    .filter(([, n]) => n >= WORD_MIN_ADDRESSES)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_WORDS)
    .map(([word, addresses]) => ({ word, addresses }));
}

export async function getAddressProfile(): Promise<AddressProfile> {
  const [index, { addresses, nonText }, mappings] = await Promise.all([
    loadRegionIndex(),
    fetchTenantAddresses(),
    loadMappings().catch(() => null),
  ]);

  const byLevel = emptyLevels();
  const shortByLevel = emptyLevels();
  let ambiguousRegency = 0;
  let provinceConflicts = 0;
  let withPostalCode = 0;
  let mappedManual = 0;
  let mappedByRule = 0;
  const provinces = new Map<string, number>();
  const regencies = new Map<string, { provinceName: string; count: number; ambiguous: boolean }>();
  const districts = new Map<string, { name: string; regencyLabel: string; count: number }>();
  const unrecognizedWords = new Map<string, number>();
  const provinceOnlyWords = new Map<string, number>();

  for (const text of addresses) {
    const { match: m, source } = resolveAddress(text, index, mappings);
    if (source === "override") mappedManual += 1;
    if (source === "rule") mappedByRule += 1;
    byLevel[m.level] += 1;
    if (m.level !== "empty" && m.wordCount <= 2) shortByLevel[m.level] += 1;
    if (m.hasPostalCode) withPostalCode += 1;
    if (m.provinceConflict) provinceConflicts += 1;

    if (m.provinceCode) {
      const name = shortProvince(index.provinces.get(m.provinceCode)!.name);
      provinces.set(name, (provinces.get(name) ?? 0) + 1);
    }
    if (m.regencyCodes.length > 0) {
      const ambiguous = m.regencyCodes.length > 1;
      if (ambiguous) ambiguousRegency += 1;
      const label = regencyLabel(m.regencyCodes, index);
      const entry = regencies.get(label) ?? { provinceName: shortProvince(index.provinces.get(m.provinceCode!)!.name), count: 0, ambiguous };
      entry.count += 1;
      regencies.set(label, entry);
    }
    if (m.districtCode) {
      const d = index.districts.get(m.districtCode)!;
      const entry = districts.get(d.code) ?? { name: d.name, regencyLabel: regencyLabel([d.regencyCode], index), count: 0 };
      entry.count += 1;
      districts.set(d.code, entry);
    }

    const words = m.leftoverWords.filter((w) => w.length >= 3 && /^[a-z]+$/.test(w) && !STOPWORDS.has(w));
    const target = m.level === "unrecognized" ? unrecognizedWords : m.level === "province" ? provinceOnlyWords : null;
    if (target) for (const w of words) target.set(w, (target.get(w) ?? 0) + 1);
  }

  const districtList = Array.from(districts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const shownDistricts = districtList.filter((d) => d.count >= DISTRICT_MIN_TENANTS);
  const hiddenDistricts = districtList.filter((d) => d.count < DISTRICT_MIN_TENANTS);

  return {
    generatedAt: new Date().toISOString(),
    totalTenants: addresses.length,
    byLevel,
    ambiguousRegency,
    provinceConflicts,
    veryShort: { total: ADDRESS_LEVELS.reduce((s, l) => s + shortByLevel[l], 0), byLevel: shortByLevel },
    withPostalCode,
    nonTextAddresses: nonText,
    provinces: Array.from(provinces.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    regencies: Array.from(regencies.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    districts: shownDistricts,
    districtsHidden: { areas: hiddenDistricts.length, tenants: hiddenDistricts.reduce((s, d) => s + d.count, 0) },
    words: { unrecognized: topWords(unrecognizedWords), provinceOnly: topWords(provinceOnlyWords) },
    mapping: { available: mappings !== null, manual: mappedManual, rule: mappedByRule },
  };
}
