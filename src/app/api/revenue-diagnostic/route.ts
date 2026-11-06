import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isMappingAllowed } from "@/lib/addressMapping";
import { paginate } from "@/lib/storeganise";

export const dynamic = "force-dynamic";

// TEMPORARY — remove once the accrual revenue module knows where an invoice
// entry's service period lives. Shows the *shape* of a few invoices and their
// entries: field paths and types. Values only for fields that can't hold
// customer data (dates, quantities, amounts, states/types).

type Field = { path: string; type: string; value?: string };

const SAFE_VALUE = /(date|start|end|period|qty|quantity|amount|total|price|state|status|type|created|updated|paid|due|sid|months?|interval|unit)$/i;
const NEVER_VALUE = /(name|email|phone|address|desc|note|owner|user|customer|contact|comment|label|title)/i;

function describe(value: unknown, path: string, out: Field[], depth = 0) {
  if (depth > 4) return;
  if (Array.isArray(value)) {
    out.push({ path, type: `array(${value.length})` });
    value.slice(0, 3).forEach((v) => describe(v, `${path}[]`, out, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    if (path) out.push({ path, type: "object" });
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) describe(v, path ? `${path}.${k}` : k, out, depth + 1);
    return;
  }
  const key = path.split(".").pop()!.replace("[]", "");
  const field: Field = { path, type: value === null ? "null" : typeof value };
  if (value !== null && value !== undefined && SAFE_VALUE.test(key) && !NEVER_VALUE.test(key)) field.value = String(value).slice(0, 40);
  out.push(field);
}

function dedupe(fields: Field[]): Field[] {
  const seen = new Map<string, Field>();
  for (const f of fields) if (!seen.has(f.path)) seen.set(f.path, f);
  return Array.from(seen.values());
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!isMappingAllowed(session?.user?.email)) return NextResponse.json({ error: "Tidak punya akses" }, { status: 403 });
  try {
    const wanted = (request.nextUrl.searchParams.get("sids") ?? "XRZTM0PK4,5LBZ10OLX")
      .split(",")
      .map((s) => s.trim().replace(/^#/, "").toUpperCase())
      .filter(Boolean)
      .slice(0, 10);
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const recent = await paginate<{ id: string; sid: string; state: string }>(`/v1/admin/invoices?start=${since}`);
    const picked = recent.filter((i) => wanted.includes(i.sid.toUpperCase()));
    const extra = recent.filter((i) => i.state === "paid" && !picked.includes(i)).slice(0, Math.max(0, 4 - picked.length));
    const ids = [...picked, ...extra].map((i) => i.id);
    const withEntries = ids.length ? await paginate<Record<string, unknown>>(`/v1/admin/invoices?ids=${ids.join(",")}&include=entries`) : [];

    const invoices = withEntries.map((inv) => {
      const top: Field[] = [];
      const { entries, ...rest } = inv as { entries?: unknown[] };
      describe(rest, "", top);
      const entryFields = (Array.isArray(entries) ? entries : []).map((e) => {
        const f: Field[] = [];
        describe(e, "", f);
        return dedupe(f);
      });
      return { sid: String(inv.sid ?? ""), requested: wanted.includes(String(inv.sid ?? "").toUpperCase()), invoice: dedupe(top), entries: entryFields };
    });
    return NextResponse.json({
      since,
      invoicesSince: recent.length,
      requested: wanted,
      notFound: wanted.filter((s) => !picked.some((p) => p.sid.toUpperCase() === s)),
      invoices,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
