import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { fetchInvoiceById } from "@/lib/storeganise";
import { sendSlackMessage } from "@/lib/slack";

type StoreganiseWebhookEvent = {
  type: string;
  data: {
    invoiceId?: string;
    to?: string;
  };
};

// Not confirmed against Storeganise's own docs (no signature-verification section was
// published) — reverse-engineered from an observed `sg-signature` header: a 44-char
// base64 string, matching an HMAC-SHA256 digest of the raw body.
function isValidSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

export async function POST(request: NextRequest) {
  const secret = process.env.STOREGANISE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "STOREGANISE_WEBHOOK_SECRET is not set" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("sg-signature");

  if (!isValidSignature(rawBody, signature, secret)) {
    console.error("Storeganise webhook signature mismatch", {
      received: signature,
      computed: createHmac("sha256", secret).update(rawBody).digest("base64"),
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: StoreganiseWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const invoiceId = event.data?.invoiceId;
  const isRelevantEvent = event.type === "invoice.payments.updated" || event.type === "invoice.state.updated";
  if (!isRelevantEvent || !invoiceId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // invoice.state.updated already tells us the resulting state directly. invoice.payments.updated
  // doesn't (a partial payment fires the same event), so that case always needs a re-fetch below
  // to confirm the invoice is actually fully paid before notifying.
  if (event.type === "invoice.state.updated" && event.data.to !== "paid") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const invoice = await fetchInvoiceById(invoiceId);
  if (invoice.state !== "paid") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const ownerName = invoice.owner?.name ?? "Unknown tenant";
  const amount = invoice.total !== undefined ? `Rp${invoice.total.toLocaleString("id-ID")}` : "-";

  await sendSlackMessage(`:moneybag: Invoice *${invoice.sid ?? invoice.id}* from *${ownerName}* has been paid (${amount}).`);

  return NextResponse.json({ ok: true });
}
