import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildPreview, parseImport } from "@/lib/addressImport";
import { getMappingOverview, isMappingAllowed } from "@/lib/addressMapping";
import { matchAddress } from "@/lib/addressMatch";
import { loadRegionIndex } from "@/lib/regions";

export const dynamic = "force-dynamic";

const MAX_TEXT = 500_000;

// Read-only: checks a pasted LLM result against the current queue. Nothing is
// saved until the reviewed rows are sent to /api/address-mapping/import.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!isMappingAllowed(session?.user?.email)) {
    return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { text?: unknown };
    if (typeof body.text !== "string" || body.text.trim() === "") {
      return NextResponse.json({ error: "Tempel hasil dari LLM dulu" }, { status: 400 });
    }
    if (body.text.length > MAX_TEXT) return NextResponse.json({ error: "Teks terlalu panjang" }, { status: 413 });
    const parsed = parseImport(body.text);
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const [index, { queue }] = await Promise.all([loadRegionIndex(), getMappingOverview()]);
    const entries = queue.map((q) => ({ hash: q.hash, text: q.text, auto: matchAddress(q.text, index) }));
    return NextResponse.json({ rows: buildPreview(parsed.rows, entries, index) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
