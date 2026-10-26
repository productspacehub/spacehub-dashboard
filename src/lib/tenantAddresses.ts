import { paginate } from "./storeganise";

type Rental = { ownerId: string; owner?: { address?: unknown } };

export type TenantAddresses = { addresses: string[]; nonText: number };

function addressText(value: unknown): { text: string; nonText: boolean } {
  if (typeof value === "string") return { text: value, nonText: false };
  if (value && typeof value === "object") {
    const parts = Object.values(value as Record<string, unknown>).filter((v): v is string => typeof v === "string");
    return { text: parts.join(", "), nonText: true };
  }
  return { text: "", nonText: false };
}

// One address per active tenant (owners of occupied rentals), however many
// units they rent. The owner object on include=owner carries `address`.
export async function fetchTenantAddresses(): Promise<TenantAddresses> {
  const rentals = await paginate<Rental>("/v1/admin/unit-rentals?state=occupied&include=owner");
  const byOwner = new Map<string, unknown>();
  for (const r of rentals) if (!byOwner.has(r.ownerId)) byOwner.set(r.ownerId, r.owner?.address);
  let nonText = 0;
  const addresses = Array.from(byOwner.values(), (value) => {
    const { text, nonText: isNonText } = addressText(value);
    if (isNonText) nonText += 1;
    return text;
  });
  return { addresses, nonText };
}
