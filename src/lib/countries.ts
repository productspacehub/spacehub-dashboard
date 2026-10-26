import { normalize } from "./normalize";

// Countries customers are likely to write. ISO 3166-1 alpha-2 codes; names
// in Indonesian. Only consulted when no Indonesian region was found.
// Aliases are country names plus a few big Asian/Australian cities that show
// up in real foreign addresses. European/American city names are left out on
// purpose: Indonesian housing clusters are often named after them, so
// "Cluster Amsterdam" must not read as the Netherlands. Detected countries
// still go through the mapping queue to be confirmed.
export type Country = { code: string; name: string; aliases: string[] };

export const COUNTRIES: Country[] = [
  { code: "SG", name: "Singapura", aliases: ["singapore", "singapura"] },
  { code: "MY", name: "Malaysia", aliases: ["malaysia", "kuala lumpur", "johor bahru", "selangor", "petaling jaya", "penang"] },
  { code: "BN", name: "Brunei", aliases: ["brunei", "brunei darussalam", "bandar seri begawan"] },
  { code: "TH", name: "Thailand", aliases: ["thailand", "bangkok"] },
  { code: "PH", name: "Filipina", aliases: ["philippines", "filipina", "manila"] },
  { code: "VN", name: "Vietnam", aliases: ["vietnam", "viet nam", "hanoi", "ho chi minh"] },
  { code: "TL", name: "Timor Leste", aliases: ["timor leste", "east timor"] },
  { code: "MM", name: "Myanmar", aliases: ["myanmar"] },
  { code: "KH", name: "Kamboja", aliases: ["cambodia", "kamboja"] },
  { code: "AU", name: "Australia", aliases: ["australia", "sydney", "melbourne", "perth", "brisbane"] },
  { code: "NZ", name: "Selandia Baru", aliases: ["new zealand", "selandia baru"] },
  { code: "JP", name: "Jepang", aliases: ["japan", "jepang", "tokyo", "osaka"] },
  { code: "KR", name: "Korea Selatan", aliases: ["korea", "south korea", "korea selatan", "republic of korea", "seoul"] },
  { code: "CN", name: "Tiongkok", aliases: ["china", "tiongkok", "beijing", "shanghai", "shenzhen", "guangzhou"] },
  { code: "HK", name: "Hong Kong", aliases: ["hong kong", "hongkong"] },
  { code: "TW", name: "Taiwan", aliases: ["taiwan", "taipei"] },
  { code: "IN", name: "India", aliases: ["india", "mumbai", "new delhi"] },
  { code: "AE", name: "Uni Emirat Arab", aliases: ["united arab emirates", "uni emirat arab", "uae", "dubai", "abu dhabi"] },
  { code: "SA", name: "Arab Saudi", aliases: ["saudi arabia", "arab saudi", "riyadh", "jeddah"] },
  { code: "QA", name: "Qatar", aliases: ["qatar", "doha"] },
  { code: "TR", name: "Turki", aliases: ["turkey", "turkiye", "turki"] },
  { code: "GB", name: "Inggris Raya", aliases: ["united kingdom", "uk", "u k", "england", "inggris", "scotland"] },
  { code: "IE", name: "Irlandia", aliases: ["ireland", "irlandia"] },
  { code: "NL", name: "Belanda", aliases: ["netherlands", "nederland", "belanda"] },
  { code: "DE", name: "Jerman", aliases: ["germany", "deutschland", "jerman"] },
  { code: "FR", name: "Prancis", aliases: ["france", "prancis", "perancis"] },
  { code: "BE", name: "Belgia", aliases: ["belgium", "belgia"] },
  { code: "CH", name: "Swiss", aliases: ["switzerland", "swiss"] },
  { code: "AT", name: "Austria", aliases: ["austria"] },
  { code: "IT", name: "Italia", aliases: ["italy", "italia"] },
  { code: "ES", name: "Spanyol", aliases: ["spain", "spanyol"] },
  { code: "PT", name: "Portugal", aliases: ["portugal"] },
  { code: "SE", name: "Swedia", aliases: ["sweden", "swedia"] },
  { code: "NO", name: "Norwegia", aliases: ["norway", "norwegia"] },
  { code: "DK", name: "Denmark", aliases: ["denmark"] },
  { code: "FI", name: "Finlandia", aliases: ["finland", "finlandia"] },
  { code: "PL", name: "Polandia", aliases: ["poland", "polandia"] },
  { code: "RU", name: "Rusia", aliases: ["russia", "rusia"] },
  { code: "US", name: "Amerika Serikat", aliases: ["united states", "united states of america", "usa", "u s a", "amerika serikat"] },
  { code: "CA", name: "Kanada", aliases: ["canada", "kanada"] },
  { code: "BR", name: "Brasil", aliases: ["brazil", "brasil"] },
];

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
const byAlias = new Map<string, string>();
for (const c of COUNTRIES) {
  byAlias.set(normalize(c.name), c.code);
  for (const a of c.aliases) byAlias.set(a, c.code);
}
const maxAliasWords = Math.max(...Array.from(byAlias.keys(), (a) => a.split(" ").length));

export const isCountry = (code: string) => byCode.has(code);
export const countryName = (code: string) => byCode.get(code)?.name ?? code;

// The last country mentioned wins, like cities: addresses run small → large.
export function detectCountry(words: string[]): string | null {
  let found: string | null = null;
  for (let i = 0; i < words.length; ) {
    let matched = 0;
    for (let n = Math.min(maxAliasWords, words.length - i); n > 0; n--) {
      const code = byAlias.get(words.slice(i, i + n).join(" "));
      if (code) {
        found = code;
        matched = n;
        break;
      }
    }
    i += matched || 1;
  }
  return found;
}

// A whole cell naming one country ("Singapore", "Negara Jepang").
export function countryFromName(raw: string): string | null {
  const n = normalize(raw).replace(/^negara /, "");
  return byAlias.get(n) ?? null;
}

export function searchCountries(q: string): { code: string; name: string; score: number }[] {
  const nq = normalize(q);
  const out: { code: string; name: string; score: number }[] = [];
  for (const c of COUNTRIES) {
    const names = [normalize(c.name), ...c.aliases];
    const score = names.some((n) => n === nq) ? 0 : names.some((n) => n.startsWith(nq)) ? 1 : names.some((n) => n.includes(nq)) ? 3 : null;
    if (score !== null) out.push({ code: c.code, name: c.name, score });
  }
  return out;
}
