import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { exportId, redactAddress, toCsv } from "@/lib/addressImport";
import { getMappingOverview, isMappingAllowed } from "@/lib/addressMapping";

export const dynamic = "force-dynamic";

// The queue as CSV for an LLM chat, with house/unit/RT numbers removed. The id
// is a prefix of the address hash, so the result can be matched back without
// sending anything that identifies the tenant.
export async function GET() {
  const session = await auth();
  if (!isMappingAllowed(session?.user?.email)) {
    return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  }
  try {
    const { queue, generatedAt } = await getMappingOverview();
    const rows = queue
      .map((q) => [exportId(q.hash), redactAddress(q.text), q.autoLabel])
      .filter(([, alamat]) => alamat !== "");
    const csv = toCsv([["id", "alamat", "terdeteksi"], ...rows]);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="antrean-alamat-${generatedAt.slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
