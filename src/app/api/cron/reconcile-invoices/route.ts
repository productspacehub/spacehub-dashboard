import { NextRequest, NextResponse } from "next/server";
import { fetchRecentlyPaidInvoices } from "@/lib/storeganise";
import { notifyIfNewlyPaid } from "@/lib/invoiceNotifications";

export const dynamic = "force-dynamic";

// Safety net for Storeganise's invoice-paid webhooks: both events are labeled BETA and
// have been observed to occasionally not deliver at all, with no error and no
// retry-exhausted alert email. This periodically re-checks recently-paid invoices and
// notifies Slack for any the webhook missed. notifyIfNewlyPaid() shares the same
// notified-invoices record as the webhook handler, so nothing gets notified twice.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const invoices = await fetchRecentlyPaidInvoices();

    let notified = 0;
    for (const invoice of invoices) {
      if (await notifyIfNewlyPaid(invoice.id)) notified += 1;
    }

    return NextResponse.json({ ok: true, checked: invoices.length, notified });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
