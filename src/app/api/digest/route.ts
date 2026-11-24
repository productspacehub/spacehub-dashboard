import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { buildDailyDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";
// Cash-in categorizes a whole month's invoices; all four sections run in parallel.
export const maxDuration = 60;

function isAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Numbers for the daily Slack digest, fetched each morning by
// productspacehub/spacehub-slack-notifier (see src/lib/digest.ts). Excluded
// from the login proxy, so it's guarded by its own shared secret, sent as
// `Authorization: Bearer <DIGEST_API_SECRET>`. Unlike the cron routes, an
// unset secret refuses every request: this returns business figures.
export async function GET(request: NextRequest) {
  const secret = process.env.DIGEST_API_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "DIGEST_API_SECRET is not set" }, { status: 503 });
  }
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sections fail independently (each carries ok/error), so this only throws
  // on something unexpected.
  try {
    return NextResponse.json(await buildDailyDigest());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
