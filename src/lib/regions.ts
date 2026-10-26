import { getDistricts, getProvinces, getRegencies } from "idn-area-data";
import { normalize } from "./normalize";

// Official Kemendagri region codes/names from the idn-area-data package
// (data under the Open Database License), indexed for matching free-text
// addresses.

export type Province = { code: string; name: string };
export type Regency = { code: string; name: string; provinceCode: string };
export type District = { code: string; name: string; regencyCode: string };

export type RegionIndex = {
  provinces: Map<string, Province>;
  regencies: Map<string, Regency>;
  districts: Map<string, District>;
  // normalized phrase -> codes
  provinceKeys: Map<string, string>;
  regencyExplicitKeys: Map<string, string>; // "kota bandung", "kab bogor", "jaksel"
  regencyBareKeys: Map<string, string[]>; // "bandung" -> [Kota Bandung, Kab. Bandung]
  districtKeys: Map<string, string[]>;
  maxPhraseWords: number;
};

const PROVINCE_ALIASES: Record<string, string[]> = {
  "11": ["nad", "nanggroe aceh darussalam"],
  "12": ["sumut"],
  "13": ["sumbar"],
  "16": ["sumsel"],
  "19": ["babel", "bangka belitung"],
  "21": ["kepri"],
  "31": ["dki", "dki jakarta", "jakarta", "jkt"],
  "32": ["jabar"],
  "33": ["jateng"],
  "34": ["diy", "di yogyakarta", "jogja", "jogjakarta", "yogya", "jogya"],
  "35": ["jatim"],
  "52": ["ntb"],
  "53": ["ntt"],
  "61": ["kalbar"],
  "62": ["kalteng"],
  "63": ["kalsel"],
  "64": ["kaltim"],
  "65": ["kaltara"],
  "71": ["sulut"],
  "72": ["sulteng"],
  "73": ["sulsel"],
  "74": ["sultra"],
  "76": ["sulbar"],
  "82": ["malut"],
};

// Well-known short forms that unambiguously name one regency (by its official
// name, so a typo here fails loudly at index build instead of silently).
const REGENCY_ALIASES: Record<string, string> = {
  jakpus: "Kota Administrasi Jakarta Pusat",
  jakut: "Kota Administrasi Jakarta Utara",
  jakbar: "Kota Administrasi Jakarta Barat",
  jaksel: "Kota Administrasi Jakarta Selatan",
  jaktim: "Kota Administrasi Jakarta Timur",
  tangsel: "Kota Tangerang Selatan",
  solo: "Kota Surakarta",
};

const REGENCY_PREFIX = /^(kabupaten administrasi|kota administrasi|kabupaten|kota)\s+/;

function provinceBare(name: string): string {
  return normalize(name).replace(/^(daerah khusus ibukota|daerah istimewa)\s+/, "");
}

// Display names: official names are long ("Kota Administrasi Jakarta
// Selatan", "Daerah Khusus Ibukota Jakarta").
export const shortRegency = (name: string) =>
  name.replace(/^Kota Administrasi /, "Kota ").replace(/^Kabupaten Administrasi /, "Kabupaten ");
export const shortProvince = (name: string) =>
  name.replace(/^Daerah Khusus Ibukota /, "DKI ").replace(/^Daerah Istimewa /, "DI ");

// One regency, or a Kota/Kabupaten pair sharing a bare name ("Bogor").
export function regencyLabel(codes: string[], index: RegionIndex): string {
  if (codes.length === 1) return shortRegency(index.regencies.get(codes[0])!.name);
  const bare = index.regencies.get(codes[0])!.name.replace(/^(Kota|Kabupaten)\s+/, "");
  return `${bare} (Kota/Kab.)`;
}

let indexPromise: Promise<RegionIndex> | undefined;

export function loadRegionIndex(): Promise<RegionIndex> {
  indexPromise ??= buildIndex().catch((err) => {
    indexPromise = undefined;
    throw err;
  });
  return indexPromise;
}

async function buildIndex(): Promise<RegionIndex> {
  const [provinceRows, regencyRows, districtRows] = await Promise.all([
    getProvinces(),
    getRegencies(),
    getDistricts(),
  ]);

  const provinces = new Map(provinceRows.map((p) => [p.code, { code: p.code, name: p.name }]));
  const regencies = new Map(
    regencyRows.map((r) => [r.code, { code: r.code, name: r.name, provinceCode: r.province_code }])
  );
  const districts = new Map(
    districtRows.map((d) => [d.code, { code: d.code, name: d.name, regencyCode: d.regency_code }])
  );

  const provinceKeys = new Map<string, string>();
  for (const p of provinces.values()) {
    provinceKeys.set(normalize(p.name), p.code);
    provinceKeys.set(provinceBare(p.name), p.code);
    for (const alias of PROVINCE_ALIASES[p.code] ?? []) provinceKeys.set(alias, p.code);
  }

  const regencyExplicitKeys = new Map<string, string>();
  const regencyBareKeys = new Map<string, string[]>();
  const byName = new Map<string, string>();
  for (const r of regencies.values()) {
    byName.set(r.name, r.code);
    const full = normalize(r.name);
    const bare = full.replace(REGENCY_PREFIX, "");
    regencyExplicitKeys.set(full, r.code);
    if (full.startsWith("kabupaten")) {
      regencyExplicitKeys.set(`kabupaten ${bare}`, r.code);
      regencyExplicitKeys.set(`kab ${bare}`, r.code);
    } else {
      regencyExplicitKeys.set(`kota ${bare}`, r.code);
      if (full.startsWith("kota administrasi")) regencyExplicitKeys.set(`kota adm ${bare}`, r.code);
    }
    // A bare name that's also a province's name ("Yogyakarta", "Jambi") reads
    // as the province unless written with "Kota"/"Kab." in front.
    if (provinceKeys.has(bare)) continue;
    regencyBareKeys.set(bare, [...(regencyBareKeys.get(bare) ?? []), r.code]);
  }
  for (const [alias, name] of Object.entries(REGENCY_ALIASES)) {
    const code = byName.get(name);
    if (!code) throw new Error(`Regency alias "${alias}" points at unknown regency "${name}"`);
    regencyExplicitKeys.set(alias, code);
  }

  const districtKeys = new Map<string, string[]>();
  for (const d of districts.values()) {
    const key = normalize(d.name);
    districtKeys.set(key, [...(districtKeys.get(key) ?? []), d.code]);
  }

  const maxPhraseWords = Math.max(
    ...[provinceKeys, regencyExplicitKeys, regencyBareKeys, districtKeys].flatMap((m) =>
      Array.from(m.keys(), (k) => k.split(" ").length)
    )
  );

  return { provinces, regencies, districts, provinceKeys, regencyExplicitKeys, regencyBareKeys, districtKeys, maxPhraseWords };
}
