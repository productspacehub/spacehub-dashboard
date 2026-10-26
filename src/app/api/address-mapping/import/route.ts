import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  applyImport,
  deleteImportBatch,
  getMappingOverview,
  isMappingAllowed,
  validateTarget,
  type MappingTarget,
  type TargetKind,
} from "@/lib/addressMapping";
import { loadRegionIndex } from "@/lib/regions";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 5000;
const BATCH = /^[0-9a-f-]{36}$/;

// Saves the rows ticked in the import preview as one batch. Only addresses
// still in the queue are taken, so nothing mapped in the meantime is touched.
export async function POST(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!isMappingAllowed(email)) return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  try {
    const body = (await request.json()) as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Tidak ada baris yang dipilih" }, { status: 400 });
    }
    if (body.items.length > MAX_ITEMS) return NextResponse.json({ error: "Terlalu banyak baris" }, { status: 413 });

    const [index, { queue }] = await Promise.all([loadRegionIndex(), getMappingOverview()]);
    const inQueue = new Set(queue.map((q) => q.hash));
    const items = new Map<string, MappingTarget>();
    let skipped = 0;
    for (const raw of body.items as { hash?: unknown; kind?: unknown; code?: unknown }[]) {
      const target = { kind: raw?.kind as TargetKind, code: typeof raw?.code === "string" ? raw.code : null };
      if (typeof raw?.hash !== "string" || validateTarget(target, index, false)) {
        return NextResponse.json({ error: "Data impor tidak valid — buat pratinjau ulang" }, { status: 400 });
      }
      if (!inQueue.has(raw.hash) || items.has(raw.hash)) skipped += 1;
      else items.set(raw.hash, target);
    }

    const { batch, inserted } = await applyImport(
      Array.from(items, ([hash, target]) => ({ hash, target })),
      email!
    );
    return NextResponse.json({ ok: true, batch, inserted, skipped: skipped + items.size - inserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!isMappingAllowed(session?.user?.email)) return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  const batch = request.nextUrl.searchParams.get("batch") ?? "";
  if (!BATCH.test(batch)) return NextResponse.json({ error: "Batch tidak valid" }, { status: 400 });
  try {
    const removed = await deleteImportBatch(batch);
    return removed > 0 ? NextResponse.json({ ok: true, removed }) : NextResponse.json({ error: "Batch tidak ditemukan" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
