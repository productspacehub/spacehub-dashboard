import { getProvinces, getRegencies } from "idn-area-data";

// NIK layout (Kemendagri): PP KK CC DDMMYY SSSS
//   PP province, KK regency, CC district, DD birth day (+40 for women),
//   MM birth month, YY birth year, SSSS serial.

export type ParsedNik = {
  provinceCode: string; // "31"
  regencyCode: string; // "31.74" — same dotted form as the region data
  birthDate: string; // YYYY-MM-DD
  sex: "L" | "P";
};

export type NikRegion = { provinceName: string; regencyName: string | null };

// Characters tesseract commonly confuses with digits on ID cards.
const DIGIT_LOOKALIKES: Record<string, string> = {
  O: "0", o: "0", D: "0", Q: "0", U: "0",
  I: "1", l: "1", i: "1", "|": "1", "!": "1", "]": "1", "[": "1", L: "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  G: "6", b: "6",
  T: "7",
  B: "8",
  g: "9", q: "9",
};

function toDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (DIGIT_LOOKALIKES[ch]) out += DIGIT_LOOKALIKES[ch];
  }
  return out;
}

// KTP holders are at least 17, so a two-digit year resolves to the 2000s only
// when that still makes the holder 17 or older.
function resolveYear(yy: number, now: Date): number {
  const y2000 = 2000 + yy;
  return y2000 <= now.getFullYear() - 17 ? y2000 : 1900 + yy;
}

export function parseNik(nik: string, now = new Date()): ParsedNik | null {
  if (!/^\d{16}$/.test(nik)) return null;
  const prov = nik.slice(0, 2);
  const kab = nik.slice(2, 4);
  let day = Number(nik.slice(6, 8));
  const month = Number(nik.slice(8, 10));
  const yy = Number(nik.slice(10, 12));

  const sex = day > 40 ? "P" : "L";
  if (day > 40) day -= 40;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (prov === "00" || kab === "00") return null;

  const year = resolveYear(yy, now);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null; // e.g. 31 Feb

  return {
    provinceCode: prov,
    regencyCode: `${prov}.${kab}`,
    birthDate: date.toISOString().slice(0, 10),
    sex,
  };
}

// Pulls a structurally valid NIK out of raw OCR text. Prefers the "NIK" line;
// falls back to any digit-heavy run elsewhere. A candidate only counts if its
// province code exists — that rejects most OCR noise that happens to be 16
// digits long.
export function extractNik(text: string, validProvinceCodes: Set<string>): string | null {
  const lines = text.split(/\r?\n/);
  const nikLines = lines.filter((l) => /N\s*[I1l]\s*K/i.test(l)).map((l) => l.replace(/^.*?N\s*[I1l]\s*K\s*[:;.=\-]?/i, ""));
  const otherLines = lines.filter((l) => !/N\s*[I1l]\s*K/i.test(l));

  const candidatesFrom = (line: string, lenient: boolean): string[] => {
    // On the NIK line itself, look-alike letters are almost certainly misread
    // digits; elsewhere only trust real digits so names/addresses aren't
    // turned into numbers.
    const digits = lenient ? toDigits(line) : line.replace(/\D/g, "");
    const found: string[] = [];
    for (let i = 0; i + 16 <= digits.length; i++) found.push(digits.slice(i, i + 16));
    return found;
  };

  const ordered = [...nikLines.flatMap((l) => candidatesFrom(l, true)), ...otherLines.flatMap((l) => candidatesFrom(l, false))];
  return ordered.find((c) => parseNik(c) !== null && validProvinceCodes.has(c.slice(0, 2))) ?? null;
}

let regionData: Promise<{ provinces: Map<string, string>; regencies: Map<string, string> }> | undefined;

export function loadRegionData() {
  regionData ??= Promise.all([getProvinces(), getRegencies()]).then(([provinces, regencies]) => ({
    provinces: new Map(provinces.map((p) => [p.code, p.name])),
    regencies: new Map(regencies.map((r) => [r.code, r.name])),
  }));
  return regionData;
}

export async function lookupRegion(parsed: ParsedNik): Promise<NikRegion | null> {
  const { provinces, regencies } = await loadRegionData();
  const provinceName = provinces.get(parsed.provinceCode);
  if (!provinceName) return null;
  // Regencies get split and renumbered over time; an older code missing from
  // the current list is still a real NIK, just without a name.
  return { provinceName, regencyName: regencies.get(parsed.regencyCode) ?? null };
}

// What's safe to show/store: region code and serial, with the birth-date part
// (already shown separately as a derived field) and district masked.
export function maskNik(nik: string): string {
  return `${nik.slice(0, 4)}••••••••${nik.slice(12)}`;
}
