import { NextRequest, NextResponse } from "next/server";
import { createContainer, listContainers } from "@/lib/bookings";

export const dynamic = "force-dynamic";

// ?q= filters by Container ID/label — powers the container lookup screen
// (§5.5: "search/filter by Container ID to instantly find which customer/
// booking a given box belongs to").
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const containers = await listContainers(q);
    return NextResponse.json({ containers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { label?: string };
    if (!body.label?.trim()) {
      return NextResponse.json({ error: "Container ID wajib diisi" }, { status: 400 });
    }
    const container = await createContainer(body.label);
    return NextResponse.json({ container }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.includes("duplicate key") || message.includes("unique");
    return NextResponse.json(
      { error: isDuplicate ? "Container ID ini sudah ada" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}
