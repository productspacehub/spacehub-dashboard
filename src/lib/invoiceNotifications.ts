import { fetchInvoiceById } from "@/lib/storeganise";
import { sendSlackMessage } from "@/lib/slack";
import { ensureSchema, isInvoiceNotified, recordInvoiceNotified } from "@/lib/db";

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

  await sendSlackMessage(`:moneybag: Invoice *${invoice.sid ?? invoice.id}* from *${ownerName}* has been paid (${amount}).`);
  await recordInvoiceNotified(invoiceId);
  return true;
}
