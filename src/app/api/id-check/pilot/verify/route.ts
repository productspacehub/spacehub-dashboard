import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPilotAllowed, setVerdict } from "@/lib/ktpPilot";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!isPilotAllowed(email)) {
    return NextResponse.json({ error: "Tidak punya akses ke pilot OCR" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { id?: unknown; verdict?: unknown };
    const id = Number(body.id);
    const verdict = body.verdict === "correct" || body.verdict === "wrong" ? body.verdict : body.verdict === null ? null : undefined;
    if (!Number.isInteger(id) || verdict === undefined) {
      return NextResponse.json({ error: "id atau verdict tidak valid" }, { status: 400 });
    }
    const updated = await setVerdict(id, verdict, email!);
    if (!updated) return NextResponse.json({ error: "Hasil tidak ditemukan atau tidak bisa diverifikasi" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
