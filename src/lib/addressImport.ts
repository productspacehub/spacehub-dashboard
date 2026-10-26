import type { AddressMatch } from "./addressMatch";
import { compareToAuto, targetLabel, type MappingTarget } from "./addressMapping";
import { normalize } from "./normalize";
import type { RegionIndex } from "./regions";

// Bulk export → (LLM, done by hand outside the dashboard) → import, for the
// address-mapping queue.

export const EXPORT_ID_LENGTH = 12;
export const exportId = (hash: string) => hash.slice(0, EXPORT_ID_LENGTH);

// Words that only introduce a number (house, unit, floor, RT/RW…) — dropped
// together with the number they introduce.
const NUMBER_MARKERS = new Set(["no", "nomor", "nmr", "unit", "rt", "rw", "blok", "blk", "lt", "lantai", "kav", "kavling", "km"]);
// …except where the number names an area rather than a home ("Bintaro Sektor 9").
const AREA_MARKERS = new Set(["sektor", "sector"]);

// What's sent out for the LLM only needs the building/area name: house, unit
// and RT/RW numbers are removed; 5-digit postal codes are kept as a location
// hint.
export function redactAddress(text: string): string {
  const kept: string[] = [];
  for (const token of text.trim().split(/\s+/)) {
    const core = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const previous = kept.length > 0 ? normalize(kept[kept.length - 1]) : "";
    if (/\d/.test(core) && !/^\d{5}$/.test(core) && !(AREA_MARKERS.has(previous) && /^\d{1,2}(\.\d{1,2})?[a-z]?$/i.test(core))) {
      if (NUMBER_MARKERS.has(previous)) kept.pop();
      // Keep a separating comma the number was carrying ("No. 5, Tebet").
      if (/[,;]$/.test(token) && kept.length > 0 && !/[,;]$/.test(kept[kept.length - 1])) kept[kept.length - 1] += ",";
      continue;
    }
    kept.push(token);
  }
  return kept
    .join(" ")
    .replace(/[,;]\s*$/, "")
    .trim();
}

// Cells starting with these are run as formulas by spreadsheet apps — and the
// address text is typed by customers.
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const BOM = String.fromCharCode(0xfeff);

// Accepts what an LLM chat typically hands back: CSV (comma/semicolon/tab),
// optionally inside a ``` code block, or a markdown table.
export function parseTable(raw: string): string[][] {
  let text = raw.replace(new RegExp(`^${BOM}`), "");
  const fence = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (fence) text = fence[1];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  if (lines[0].trim().startsWith("|")) {
    return lines
      .filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l))
      .map((l) =>
        l
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim())
      );
  }

  const first = lines[0];
  const count = (ch: string) => first.split(ch).length - 1;
  const delimiter = count("\t") > 0 ? "\t" : count(";") > count(",") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = lines.join("\n");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((r) => r.some((c) => c !== ""));
}

export type SuggestionStatus = "ok" | "unsure" | "foreign";
export type ImportedRow = { id: string; kecamatan: string; kota: string; provinsi: string; status: SuggestionStatus; line: number };

const HEADERS: Record<"id" | "kecamatan" | "kota" | "provinsi" | "status", string[]> = {
  id: ["id"],
  kecamatan: ["kecamatan", "kec", "district"],
  kota: ["kota kabupaten", "kota kab", "kota", "kabupaten", "city", "regency"],
  provinsi: ["provinsi", "prov", "province"],
  status: ["status", "keyakinan", "confidence"],
};

function parseStatus(raw: string): SuggestionStatus {
  const s = normalize(raw);
  if (/tidak yakin|ragu|unsure|uncertain|unknown|tidak tahu/.test(s)) return "unsure";
  if (/luar negeri|foreign|abroad|overseas/.test(s)) return "foreign";
  return "ok";
}

export function parseImport(raw: string): { rows: ImportedRow[]; error: string | null } {
  const table = parseTable(raw);
  if (table.length < 2) return { rows: [], error: "Tidak ada data — tempel CSV lengkap dengan baris judul (header)." };
  const header = table[0].map((h) => normalize(h));
  const col = (key: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[key].includes(h));
  const idx = { id: col("id"), kecamatan: col("kecamatan"), kota: col("kota"), provinsi: col("provinsi"), status: col("status") };
  if (idx.id < 0) return { rows: [], error: 'Kolom "id" tidak ditemukan di baris judul.' };
  if (idx.kecamatan < 0 && idx.kota < 0 && idx.provinsi < 0) {
    return { rows: [], error: "Tidak ada kolom kecamatan / kota_kabupaten / provinsi di baris judul." };
  }
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows = table
    .slice(1)
    .map((r, i) => ({
      id: get(r, idx.id).toLowerCase().replace(/[^0-9a-f]/g, ""),
      kecamatan: get(r, idx.kecamatan),
      kota: get(r, idx.kota),
      provinsi: get(r, idx.provinsi),
      status: parseStatus(get(r, idx.status)),
      line: i + 2,
    }))
    .filter((r) => r.id !== "");
  return { rows, error: null };
}

type Resolution = { target: MappingTarget | null; problem: string | null; notes: string[] };

const stripPrefix = (s: string, prefixes: string[]) => {
  for (const p of prefixes) if (s.startsWith(`${p} `)) return s.slice(p.length + 1);
  return s;
};

// Turns the LLM's region *names* into official codes. Everything it says has
// to agree with itself (kecamatan inside that kota, kota inside that
// province); anything that can't be pinned down is reported, never guessed.
export function resolveSuggestion(s: Omit<ImportedRow, "id" | "line">, index: RegionIndex): Resolution {
  const notes: string[] = [];
  if (s.status === "unsure") return { target: null, problem: "LLM tidak yakin", notes };
  if (s.status === "foreign") return { target: { kind: "foreign", code: null }, problem: null, notes };

  const provinceOf = (regencyCode: string) => index.regencies.get(regencyCode)!.provinceCode;

  let province: string | null = null;
  if (s.provinsi) {
    province = index.provinceKeys.get(stripPrefix(normalize(s.provinsi), ["provinsi", "prov"])) ?? null;
    if (!province) notes.push(`provinsi "${s.provinsi}" tidak dikenali`);
  }

  let regencies: string[] = [];
  if (s.kota) {
    const n = normalize(s.kota);
    const explicit = index.regencyExplicitKeys.get(n);
    if (explicit) regencies = [explicit];
    else {
      const bare = stripPrefix(n, ["kota administrasi", "kabupaten administrasi", "kota adm", "kota", "kabupaten", "kab"]);
      regencies = index.regencyBareKeys.get(bare) ?? [];
      if (regencies.length === 0) {
        regencies = [index.regencyExplicitKeys.get(`kota ${bare}`), index.regencyExplicitKeys.get(`kabupaten ${bare}`)].filter(
          (c): c is string => !!c
        );
      }
    }
    if (regencies.length === 0) notes.push(`kota/kabupaten "${s.kota}" tidak dikenali`);
    else if (province) {
      const inProvince = regencies.filter((c) => provinceOf(c) === province);
      if (inProvince.length === 0) return { target: null, problem: `${s.kota} tidak berada di provinsi ${s.provinsi}`, notes };
      regencies = inProvince;
    }
  }

  if (s.kecamatan) {
    const n = stripPrefix(normalize(s.kecamatan), ["kecamatan", "kec"]);
    let candidates = (index.districtKeys.get(n) ?? []).map((c) => index.districts.get(c)!);
    if (regencies.length > 0) candidates = candidates.filter((d) => regencies.includes(d.regencyCode));
    else if (province) candidates = candidates.filter((d) => provinceOf(d.regencyCode) === province);
    if (candidates.length === 1) return { target: { kind: "district", code: candidates[0].code }, problem: null, notes };
    notes.push(
      candidates.length === 0
        ? `kecamatan "${s.kecamatan}" tidak dikenali${s.kota ? ` di ${s.kota}` : ""}`
        : `kecamatan "${s.kecamatan}" ada di beberapa tempat`
    );
  }

  if (regencies.length === 1) return { target: { kind: "regency", code: regencies[0] }, problem: null, notes };
  if (regencies.length > 1) {
    notes.push(`"${s.kota}" bisa kota atau kabupaten`);
    return { target: { kind: "province", code: provinceOf(regencies[0]) }, problem: null, notes };
  }
  if (province) return { target: { kind: "province", code: province }, problem: null, notes };
  return { target: null, problem: "tidak ada wilayah yang dikenali", notes };
}

export type PreviewStatus = "ready" | "conflict" | "no_gain" | "skipped" | "not_found" | "duplicate";

export type PreviewRow = {
  line: number;
  id: string;
  hash: string | null;
  address: string | null;
  suggestion: string;
  status: PreviewStatus;
  target: MappingTarget | null;
  label: string | null;
  message: string | null;
};

export type QueueEntry = { hash: string; text: string; auto: AddressMatch };

export function buildPreview(rows: ImportedRow[], queue: QueueEntry[], index: RegionIndex): PreviewRow[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const suggestion = [r.kecamatan, r.kota, r.provinsi].filter(Boolean).join(" · ") + (r.status === "ok" ? "" : ` (${r.status === "unsure" ? "tidak yakin" : "luar negeri"})`);
    const base = { line: r.line, id: r.id, suggestion: suggestion || "–", hash: null, address: null, target: null, label: null };
    const item = r.id.length >= 8 ? queue.find((q) => q.hash.startsWith(r.id)) : undefined;
    if (!item) return { ...base, status: "not_found", message: "id tidak ada di antrean (mungkin sudah dipetakan, atau alamatnya berubah)" };
    if (seen.has(item.hash)) return { ...base, hash: item.hash, address: item.text, status: "duplicate", message: "id ini muncul lebih dari sekali — baris pertama yang dipakai" };
    seen.add(item.hash);
    const withItem = { ...base, hash: item.hash, address: item.text };
    const res = resolveSuggestion(r, index);
    const notes = res.notes.length > 0 ? res.notes.join("; ") : null;
    if (!res.target) return { ...withItem, status: "skipped", message: [res.problem, notes].filter(Boolean).join("; ") };
    const label = targetLabel(res.target, index);
    const { addsDetail, contradicts } = compareToAuto(res.target, item.auto, index);
    if (contradicts) {
      return { ...withItem, target: res.target, label, status: "conflict", message: ["bertentangan dengan kota/provinsi yang tertulis di alamat", notes].filter(Boolean).join("; ") };
    }
    // Confirming a "probably abroad" guess takes it out of the queue too.
    const confirmsForeign = res.target.kind === "foreign" && item.auto.level === "foreign";
    if (!addsDetail && !confirmsForeign) return { ...withItem, target: res.target, label, status: "no_gain", message: ["tidak lebih detail dari deteksi otomatis", notes].filter(Boolean).join("; ") };
    return { ...withItem, target: res.target, label, status: "ready", message: notes };
  });
}
