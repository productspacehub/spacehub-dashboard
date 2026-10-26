import type { AddressLevel } from "./addressMatch";
import { loadMappings, resolveAddress, type ResolvedAddress } from "./addressMapping";
import { countryName } from "./countries";
import { fetchCustomerAddresses, SEGMENTS, type CustomerAddresses, type Segment } from "./customerAddresses";
import { loadRegionIndex, regencyLabel, shortProvince, type RegionIndex } from "./regions";

// Words/areas below these counts are left out so no individual customer can
// be picked out from the profile.
export const WORD_MIN_ADDRESSES = 5;
export const DISTRICT_MIN_PEOPLE = 3;
export const COUNTRY_MIN_PEOPLE = 3;
const TOP_WORDS = 30;

export const ADDRESS_LEVELS: AddressLevel[] = ["district", "regency", "province", "foreign", "unrecognized", "empty"];

export type WordCount = { word: string; addresses: number };

export type SegmentKey = "all" | Segment;

// Aggregates only — never an address or a customer name.
export type SegmentProfile = {
  total: number;
  byLevel: Record<AddressLevel, number>;
  ambiguousRegency: number;
  provinceConflicts: number;
  veryShort: { total: number; byLevel: Record<AddressLevel, number> };
  withPostalCode: number;
  provinces: { name: string; count: number }[];
  regencies: { label: string; provinceName: string; count: number; ambiguous: boolean }[];
  districts: { name: string; regencyLabel: string; count: number }[];
  districtsHidden: { areas: number; people: number };
  // Abroad, by country (detected from the text or set by mapping).
  countries: { name: string; count: number }[];
  countriesHidden: { countries: number; people: number };
  countryUnknown: number;
  words: { unrecognized: WordCount[]; provinceOnly: WordCount[] };
  // How many of these went through manual mappings rather than automatic
  // matching.
  mapping: { manual: number; rule: number };
};

export type AddressProfile = {
  generatedAt: string;
  // Only "active" when the other segments couldn't be read (see `others`).
  segments: Partial<Record<SegmentKey, SegmentProfile>>;
  others: CustomerAddresses["others"];
  nonTextAddresses: number;
  // false when manual mappings couldn't be loaded (automatic matching only).
  mappingAvailable: boolean;
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

function buildSegmentProfile(items: ResolvedAddress[], index: RegionIndex): SegmentProfile {
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
  const countries = new Map<string, number>();
  let countryUnknown = 0;

  for (const { match: m, source } of items) {
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
    if (m.level === "foreign") {
      if (m.countryCode) countries.set(m.countryCode, (countries.get(m.countryCode) ?? 0) + 1);
      else countryUnknown += 1;
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
  const hiddenDistricts = districtList.filter((d) => d.count < DISTRICT_MIN_PEOPLE);
  const countryList = Array.from(countries, ([code, count]) => ({ name: countryName(code), count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
  const hiddenCountries = countryList.filter((c) => c.count < COUNTRY_MIN_PEOPLE);

  return {
    total: items.length,
    byLevel,
    ambiguousRegency,
    provinceConflicts,
    veryShort: { total: ADDRESS_LEVELS.reduce((s, l) => s + shortByLevel[l], 0), byLevel: shortByLevel },
    withPostalCode,
    provinces: Array.from(provinces.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    regencies: Array.from(regencies.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    districts: districtList.filter((d) => d.count >= DISTRICT_MIN_PEOPLE),
    districtsHidden: { areas: hiddenDistricts.length, people: hiddenDistricts.reduce((s, d) => s + d.count, 0) },
    countries: countryList.filter((c) => c.count >= COUNTRY_MIN_PEOPLE),
    countriesHidden: { countries: hiddenCountries.length, people: hiddenCountries.reduce((s, c) => s + c.count, 0) },
    countryUnknown,
    words: { unrecognized: topWords(unrecognizedWords), provinceOnly: topWords(provinceOnlyWords) },
    mapping: { manual: mappedManual, rule: mappedByRule },
  };
}

export async function getAddressProfile(): Promise<AddressProfile> {
  const [index, { customers, nonText, others }, mappings] = await Promise.all([
    loadRegionIndex(),
    fetchCustomerAddresses(),
    loadMappings().catch(() => null),
  ]);

  const resolved = customers.map((c) => ({ segment: c.segment, ...resolveAddress(c.address, index, mappings) }));
  const segments: AddressProfile["segments"] = {};
  const keys: SegmentKey[] = others.available ? ["all", ...SEGMENTS] : ["active"];
  for (const key of keys) {
    segments[key] = buildSegmentProfile(key === "all" ? resolved : resolved.filter((r) => r.segment === key), index);
  }

  return {
    generatedAt: new Date().toISOString(),
    segments,
    others,
    nonTextAddresses: nonText,
    mappingAvailable: mappings !== null,
  };
}
