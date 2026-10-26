import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { addRule, deleteRule, isMappingAllowed, validatePhrase, validateTarget, type TargetKind } from "@/lib/addressMapping";
import { loadRegionIndex } from "@/lib/regions";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!isMappingAllowed(email)) return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  try {
    const body = (await request.json()) as { phrase?: unknown; kind?: unknown; code?: unknown };
    if (typeof body.phrase !== "string") return NextResponse.json({ error: "Frasa wajib diisi" }, { status: 400 });
    const checked = validatePhrase(body.phrase);
    if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
    const target = { kind: body.kind as TargetKind, code: typeof body.code === "string" ? body.code : null };
    const index = await loadRegionIndex();
    const invalid = validateTarget(target, index, false);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const result = await addRule(checked.phrase, target, email!, index);
    if ("conflict" in result) return NextResponse.json({ error: result.conflict }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!isMappingAllowed(session?.user?.email)) return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Aturan tidak valid" }, { status: 400 });
  try {
    const deleted = await deleteRule(id);
    return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Aturan tidak ditemukan" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
