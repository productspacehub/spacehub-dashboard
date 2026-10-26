import { matchAddress, type AddressLevel } from "./addressMatch";
import { loadRegionIndex, type RegionIndex } from "./regions";
import { paginate } from "./storeganise";

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
};

type Rental = { ownerId: string; owner?: { address?: unknown } };

// Structural words that say nothing about where someone lives.
const STOPWORDS = new Set([
  "jl", "jln", "jalan", "no", "nomor", "nmr", "rt", "rw", "blok", "blk", "kav", "kavling", "km", "gg", "gang",
  "kel", "kelurahan", "kec", "kecamatan", "desa", "dusun", "kota", "kab", "kabupaten", "prov", "provinsi",
  "indonesia", "dan", "lantai", "unit", "the", "and", "raya",
]);

function addressText(value: unknown): { text: string; nonText: boolean } {
  if (typeof value === "string") return { text: value, nonText: false };
  if (value && typeof value === "object") {
    const parts = Object.values(value as Record<string, unknown>).filter((v): v is string => typeof v === "string");
    return { text: parts.join(", "), nonText: true };
  }
  return { text: "", nonText: false };
}

const shortRegency = (name: string) => name.replace(/^Kota Administrasi /, "Kota ").replace(/^Kabupaten Administrasi /, "Kabupaten ");
const shortProvince = (name: string) => name.replace(/^Daerah Khusus Ibukota /, "DKI ").replace(/^Daerah Istimewa /, "DI ");

function regencyLabel(codes: string[], index: RegionIndex): string {
  if (codes.length === 1) return shortRegency(index.regencies.get(codes[0])!.name);
  const bare = index.regencies.get(codes[0])!.name.replace(/^(Kota|Kabupaten)\s+/, "");
  return `${bare} (Kota/Kab.)`;
}

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
  const [index, rentals] = await Promise.all([
    loadRegionIndex(),
    paginate<Rental>("/v1/admin/unit-rentals?state=occupied&include=owner"),
  ]);

  // One address per tenant, however many units they rent.
  const addressByOwner = new Map<string, unknown>();
  for (const r of rentals) if (!addressByOwner.has(r.ownerId)) addressByOwner.set(r.ownerId, r.owner?.address);

  const byLevel = emptyLevels();
  const shortByLevel = emptyLevels();
  let ambiguousRegency = 0;
  let provinceConflicts = 0;
  let withPostalCode = 0;
  let nonTextAddresses = 0;
  const provinces = new Map<string, number>();
  const regencies = new Map<string, { provinceName: string; count: number; ambiguous: boolean }>();
  const districts = new Map<string, { name: string; regencyLabel: string; count: number }>();
  const unrecognizedWords = new Map<string, number>();
  const provinceOnlyWords = new Map<string, number>();

  for (const value of addressByOwner.values()) {
    const { text, nonText } = addressText(value);
    if (nonText) nonTextAddresses += 1;
    const m = matchAddress(text, index);
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
    totalTenants: addressByOwner.size,
    byLevel,
    ambiguousRegency,
    provinceConflicts,
    veryShort: { total: ADDRESS_LEVELS.reduce((s, l) => s + shortByLevel[l], 0), byLevel: shortByLevel },
    withPostalCode,
    nonTextAddresses,
    provinces: Array.from(provinces.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    regencies: Array.from(regencies.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    districts: shownDistricts,
    districtsHidden: { areas: hiddenDistricts.length, tenants: hiddenDistricts.reduce((s, d) => s + d.count, 0) },
    words: { unrecognized: topWords(unrecognizedWords), provinceOnly: topWords(provinceOnlyWords) },
  };
}
