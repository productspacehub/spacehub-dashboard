// Lowercase, strip accents, and collapse everything but letters/digits to
// single spaces. Shared by the server-side address matcher and the browser
// (rule previews on /address-mapping), so it can't import anything server-only.
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
