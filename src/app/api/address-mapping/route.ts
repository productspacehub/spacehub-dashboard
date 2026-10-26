import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMappingOverview, isMappingAllowed } from "@/lib/addressMapping";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!isMappingAllowed(session?.user?.email)) {
    return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  }
  try {
    return NextResponse.json(await getMappingOverview());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
