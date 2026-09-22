import { fetchInvoiceById, fetchInvoiceActions } from "@/lib/storeganise";
import { sendSlackMessage } from "@/lib/slack";
import { ensureSchema, isInvoiceNotified, recordInvoiceNotified } from "@/lib/db";

// invoice.paid (and payments[].date/created) were found to be date-only with no
// time-of-day for manually-entered payments — always midnight UTC regardless of the
// actual payment time. The invoice's action history has full-precision timestamps
// instead, confirmed against a real "markInvoicePaid" action matching the exact time
// shown in Storeganise's own dashboard timeline. Falls back to invoice.paid if the
// actions call fails or no such action is found, rather than failing the notification.
async function findPaidAtTimestamp(invoiceId: string, fallback: string | undefined): Promise<string | undefined> {
  try {
    const actions = await fetchInvoiceActions(invoiceId);
    const markedPaid = actions.find((a) => a.type === "markInvoicePaid");
    if (markedPaid) return markedPaid.date;
  } catch {
    // fall through to the less precise fallback below
  }
  return fallback;
}

function formatPaidAt(paidIso: string): string {
  const formatted = new Date(paidIso).toLocaleString("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatted} WIB`;
}

// Shared by the webhook handler and the reconciliation cron, so an invoice already
// notified by one path is never notified again by the other. Returns whether a
// notification was actually sent (false if already notified, or not actually paid).
export async function notifyIfNewlyPaid(invoiceId: string): Promise<boolean> {
  await ensureSchema();
  if (await isInvoiceNotified(invoiceId)) return false;

  const invoice = await fetchInvoiceById(invoiceId);
  if (invoice.state !== "paid") return false;

  const ownerName = invoice.owner?.name ?? "Unknown tenant";
  const amount = invoice.total !== undefined ? `Rp${invoice.total.toLocaleString("id-ID")}` : "-";
  const paidTimestamp = await findPaidAtTimestamp(invoiceId, invoice.paid);
  const paidAt = paidTimestamp ? formatPaidAt(paidTimestamp) : "unknown time";

  await sendSlackMessage(
    `:moneybag: Invoice *${invoice.sid ?? invoice.id}* from *${ownerName}* has been paid (${amount}) on ${paidAt}.`
  );
  await recordInvoiceNotified(invoiceId);
  return true;
}
