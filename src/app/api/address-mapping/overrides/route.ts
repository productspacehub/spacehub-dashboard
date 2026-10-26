import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteOverride, isMappingAllowed, setOverride, validateTarget, type TargetKind } from "@/lib/addressMapping";
import { loadRegionIndex } from "@/lib/regions";

export const dynamic = "force-dynamic";

const HASH = /^[0-9a-f]{64}$/;

export async function POST(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!isMappingAllowed(email)) return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  try {
    const body = (await request.json()) as { hash?: unknown; kind?: unknown; code?: unknown };
    if (typeof body.hash !== "string" || !HASH.test(body.hash)) return NextResponse.json({ error: "Alamat tidak valid" }, { status: 400 });
    const target = { kind: body.kind as TargetKind, code: typeof body.code === "string" ? body.code : null };
    const invalid = validateTarget(target, await loadRegionIndex(), true);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    await setOverride(body.hash, target, email!);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!isMappingAllowed(session?.user?.email)) return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  const hash = request.nextUrl.searchParams.get("hash") ?? "";
  if (!HASH.test(hash)) return NextResponse.json({ error: "Alamat tidak valid" }, { status: 400 });
  try {
    const deleted = await deleteOverride(hash);
    return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Pemetaan tidak ditemukan" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
