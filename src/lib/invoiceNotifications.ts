import { fetchInvoiceById, StoreganiseInvoiceDetail } from "@/lib/storeganise";
import { sendSlackMessage } from "@/lib/slack";
import { ensureSchema, isInvoiceNotified, recordInvoiceNotified } from "@/lib/db";

// invoice.paid isn't reliable on its own — observed to sometimes hold a stale/unrelated
// date (e.g. midnight on the invoice's billing-period start) instead of the actual
// payment moment, at least for invoices paid via a manual admin action rather than the
// automatic gateway flow. The invoice's own payment records are the more trustworthy
// source of "when did this actually get paid," so prefer the most recent one's date.
function latestPaidTimestamp(invoice: StoreganiseInvoiceDetail): string | undefined {
  const paymentDates = (invoice.payments ?? [])
    .map((p) => p.date ?? p.created)
    .filter((d): d is string => Boolean(d))
    .sort();
  return paymentDates[paymentDates.length - 1] ?? invoice.paid;
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
  const paidTimestamp = latestPaidTimestamp(invoice);
  const paidAt = paidTimestamp ? formatPaidAt(paidTimestamp) : "unknown time";

  await sendSlackMessage(
    `:moneybag: Invoice *${invoice.sid ?? invoice.id}* from *${ownerName}* has been paid (${amount}) on ${paidAt}.`
  );
  await recordInvoiceNotified(invoiceId);
  return true;
}
