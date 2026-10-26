import { detectCountry } from "./countries";
import { normalize } from "./normalize";
import type { RegionIndex } from "./regions";

export type AddressLevel = "empty" | "district" | "regency" | "province" | "foreign" | "unrecognized";

export type AddressMatch = {
  level: AddressLevel;
  provinceCode: string | null;
  // One code, or two when only a bare name shared by a city and a regency
  // (Kota/Kab. Bogor) was written.
  regencyCodes: string[];
  districtCode: string | null;
  // ISO 3166-1 alpha-2 code, only for level "foreign".
  countryCode: string | null;
  // The written province disagrees with the city/district found.
  provinceConflict: boolean;
  hasPostalCode: boolean;
  wordCount: number;
  // Normalized words that weren't part of any region match or street name.
  leftoverWords: string[];
};

// Words that start a street or village name: the following words name the
// street/village, not a city — "Jl. Bandung No. 5, Malang" is in Malang.
const STREET_WORDS = new Set(["jl", "jln", "jalan", "gg", "gang"]);
const VILLAGE_WORDS = new Set(["kel", "kelurahan", "desa", "ds", "dusun"]);
// Where a street/village name ends.
const NAME_STOP = new Set(["no", "nomor", "nmr", "rt", "rw", "blok", "blk", "kav", "kavling", "km", "kel", "kelurahan", "kec", "kecamatan", "kota", "kab", "kabupaten"]);
const MAX_NAME_WORDS = 5;
const DISTRICT_PREFIX = new Set(["kec", "kecamatan"]);

type Token = { word: string; segment: number; skip: boolean };
type Hit = { kind: "province" | "regency" | "district"; codes: string[]; pos: number; words: number; prefixed: boolean };

function tokenize(text: string, skipNames: boolean): Token[] {
  const tokens: Token[] = [];
  text.split(/[,;\n\r/]+/).forEach((segment, segIndex) => {
    const words = normalize(segment).split(" ").filter(Boolean);
    let skipLeft = 0;
    for (const word of words) {
      if (skipLeft > 0 && (NAME_STOP.has(word) || /^\d+$/.test(word))) skipLeft = 0;
      tokens.push({ word, segment: segIndex, skip: skipLeft > 0 });
      if (skipLeft > 0) skipLeft -= 1;
      if (skipNames && (STREET_WORDS.has(word) || VILLAGE_WORDS.has(word))) skipLeft = MAX_NAME_WORDS;
    }
  });
  return tokens;
}

function findHits(tokens: Token[], index: RegionIndex): Hit[] {
  const hits: Hit[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].skip) continue;
    // Longest phrase first, within one comma-separated segment, so
    // "jakarta selatan" wins over "jakarta" and "batu ceper" over "batu".
    for (let n = Math.min(index.maxPhraseWords, tokens.length - i); n >= 1; n--) {
      const span = tokens.slice(i, i + n);
      if (span.some((t) => t.skip || t.segment !== tokens[i].segment)) continue;
      const phrase = span.map((t) => t.word).join(" ");
      const prefixed = i > 0 && DISTRICT_PREFIX.has(tokens[i - 1].word);
      let hit: Hit | null = null;
      const explicit = index.regencyExplicitKeys.get(phrase);
      const province = index.provinceKeys.get(phrase);
      const bare = index.regencyBareKeys.get(phrase);
      const district = index.districtKeys.get(phrase);
      if (prefixed && district) hit = { kind: "district", codes: district, pos: i, words: n, prefixed };
      else if (explicit) hit = { kind: "regency", codes: [explicit], pos: i, words: n, prefixed };
      else if (province) hit = { kind: "province", codes: [province], pos: i, words: n, prefixed };
      else if (bare) hit = { kind: "regency", codes: bare, pos: i, words: n, prefixed };
      else if (district) hit = { kind: "district", codes: district, pos: i, words: n, prefixed };
      if (hit) {
        hits.push(hit);
        i += n - 1;
        break;
      }
    }
  }
  return hits;
}

const DETAIL: Record<AddressLevel, number> = { empty: 0, unrecognized: 1, foreign: 1, province: 2, regency: 3, district: 4 };

export function matchAddress(raw: string | null | undefined, index: RegionIndex): AddressMatch {
  const text = (raw ?? "").trim();
  const first = analyze(text, tokenize(text, true), index);
  if (DETAIL[first.level] >= DETAIL.regency || first.level === "empty") return first;
  // With no commas or house number, the street skip can swallow the city too
  // ("Jl Kemang Raya Jakarta Selatan"). Retry without it, but only keep the
  // result if it doesn't contradict a province the first pass found — so
  // "Jl. Bandung No. 5, Jakarta" stays Jakarta rather than becoming Bandung.
  const second = analyze(text, tokenize(text, false), index);
  const contradicts = first.provinceCode !== null && second.provinceCode !== first.provinceCode;
  return DETAIL[second.level] > DETAIL[first.level] && !contradicts && !second.provinceConflict ? second : first;
}

function analyze(text: string, tokens: Token[], index: RegionIndex): AddressMatch {
  const base = {
    provinceConflict: false,
    hasPostalCode: /\b[1-9]\d{4}\b/.test(text),
    wordCount: tokens.length,
  };
  if (tokens.length === 0) {
    return { ...base, level: "empty", provinceCode: null, regencyCodes: [], districtCode: null, countryCode: null, leftoverWords: [] };
  }

  const hits = findHits(tokens, index);
  const latestFirst = [...hits].sort((a, b) => b.pos - a.pos);
  const provinceOf = (regencyCode: string) => index.regencies.get(regencyCode)!.provinceCode;

  const writtenProvince = latestFirst.find((h) => h.kind === "province")?.codes[0] ?? null;

  // Addresses usually run small → large, so the last-mentioned city is the
  // real one; prefer cities inside the written province when there is one.
  const regencyHits = latestFirst.filter((h) => h.kind === "regency");
  const inProvince = regencyHits
    .map((h) => (writtenProvince ? h.codes.filter((c) => provinceOf(c) === writtenProvince) : h.codes))
    .find((codes) => codes.length > 0);
  let regencyCodes = inProvince ?? regencyHits[0]?.codes ?? [];

  let districtCode: string | null = null;
  let acceptedDistrict: Hit | null = null;
  for (const h of latestFirst.filter((x) => x.kind === "district")) {
    const candidates = h.codes.map((c) => index.districts.get(c)!);
    let picked: typeof candidates = [];
    if (regencyCodes.length > 0) {
      // Must sit inside the city found — and can tell Kota from Kab. apart.
      picked = candidates.filter((d) => regencyCodes.includes(d.regencyCode));
    } else if (writtenProvince) {
      // Unique within the written province ("Tebet, Jakarta").
      const scope = candidates.filter((d) => provinceOf(d.regencyCode) === writtenProvince);
      if (scope.length === 1) picked = scope;
    } else if (candidates.length === 1 && (h.prefixed || h.words >= 2)) {
      // No city or province to check against: a lone one-word name is too
      // often a local area name that happens to match a kecamatan elsewhere
      // ("Kemang" usually means South Jakarta, not Kec. Kemang in Bogor).
      picked = candidates;
    }
    if (picked.length === 1) {
      districtCode = picked[0].code;
      regencyCodes = [picked[0].regencyCode];
      acceptedDistrict = h;
      break;
    }
  }

  const derivedProvince = regencyCodes.length > 0 ? provinceOf(regencyCodes[0]) : null;
  const provinceCode = derivedProvince ?? writtenProvince;
  const provinceConflict = !!writtenProvince && !!derivedProvince && writtenProvince !== derivedProvince;

  // A kecamatan match that was rejected ("Kemang" outside Bogor) didn't place
  // the address anywhere, so its words count as unrecognized — they're often
  // exactly the local area names worth adding as aliases.
  const recognized = tokens.map(() => false);
  for (const h of hits) {
    if (h.kind === "district" && h !== acceptedDistrict) continue;
    for (let k = h.pos; k < h.pos + h.words; k++) recognized[k] = true;
  }
  const leftoverWords = Array.from(new Set(tokens.filter((t, i) => !recognized[i] && !t.skip).map((t) => t.word)));

  let level: AddressLevel;
  let countryCode: string | null = null;
  if (districtCode) level = "district";
  else if (regencyCodes.length > 0) level = "regency";
  else if (provinceCode) level = "province";
  else {
    // Street names are skipped here too: "Jl. Singapore" isn't abroad.
    countryCode = detectCountry(tokens.filter((t) => !t.skip).map((t) => t.word));
    level = countryCode ? "foreign" : "unrecognized";
  }

  return { ...base, level, provinceCode, regencyCodes, districtCode, countryCode, provinceConflict, leftoverWords };
}
