import { fetchInvoiceById } from "@/lib/storeganise";
import { sendSlackMessage } from "@/lib/slack";
import { ensureSchema, isInvoiceNotified, recordInvoiceNotified } from "@/lib/db";

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
  const paidAt = invoice.paid ? formatPaidAt(invoice.paid) : "unknown time";

  await sendSlackMessage(
    `:moneybag: Invoice *${invoice.sid ?? invoice.id}* from *${ownerName}* has been paid (${amount}) on ${paidAt}.`
  );
  await recordInvoiceNotified(invoiceId);
  return true;
}
