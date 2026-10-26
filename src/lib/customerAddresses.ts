import { paginate } from "./storeganise";

// Every customer is in exactly one segment, checked in this order: an
// occupied unit beats a reservation, which beats a past rental.
export const SEGMENTS = ["active", "reserved", "movedOut", "neverRented"] as const;
export type Segment = (typeof SEGMENTS)[number];

export type CustomerAddress = { segment: Segment; address: string };

export type CustomerAddresses = {
  customers: CustomerAddress[];
  nonText: number;
  // Everyone but active tenants comes from the user list plus the ended and
  // reserved rental lists. If any of those can't be read, only active
  // tenants are returned and the error says why.
  others:
    | { available: true; usersInList: number; listWithAddress: number; staffExcluded: number }
    | { available: false; error: string };
};

type OccupiedRental = { ownerId: string; owner?: { address?: unknown } };
type RentalOwner = { ownerId: string };
type ListUser = { id: string; email?: string; address?: unknown };

// Accounts on the company domain that never rented are staff/test accounts,
// not prospects. (Active tenants are kept as they are: a unit rented under a
// staff email is still an occupied unit.)
const STAFF_DOMAIN = "@spacehub.id";

function addressText(value: unknown): { text: string; nonText: boolean } {
  if (typeof value === "string") return { text: value, nonText: false };
  if (value && typeof value === "object") {
    const parts = Object.values(value as Record<string, unknown>).filter((v): v is string => typeof v === "string");
    return { text: parts.join(", "), nonText: true };
  }
  return { text: "", nonText: false };
}

export async function fetchCustomerAddresses(): Promise<CustomerAddresses> {
  const [occupied, rest] = await Promise.all([
    // Active tenants: the owner object on include=owner carries `address`.
    paginate<OccupiedRental>("/v1/admin/unit-rentals?state=occupied&include=owner"),
    Promise.all([
      paginate<ListUser>("/v1/admin/users"),
      paginate<RentalOwner>("/v1/admin/unit-rentals?state=ended"),
      paginate<RentalOwner>("/v1/admin/unit-rentals?state=reserved"),
    ]).catch((err: unknown) => (err instanceof Error ? err.message : String(err))),
  ]);

  let nonText = 0;
  const toText = (value: unknown) => {
    const { text, nonText: isNonText } = addressText(value);
    if (isNonText) nonText += 1;
    return text;
  };

  const activeOwners = new Map<string, unknown>();
  for (const r of occupied) if (!activeOwners.has(r.ownerId)) activeOwners.set(r.ownerId, r.owner?.address);
  const customers: CustomerAddress[] = Array.from(activeOwners.values(), (a) => ({ segment: "active" as const, address: toText(a) }));

  if (typeof rest === "string") return { customers, nonText, others: { available: false, error: rest } };

  const [users, ended, reserved] = rest;
  const reservedOwners = new Set(reserved.map((r) => r.ownerId));
  const endedOwners = new Set(ended.map((r) => r.ownerId));
  let listWithAddress = 0;
  let staffExcluded = 0;
  for (const u of users) {
    if (addressText(u.address).text.trim()) listWithAddress += 1;
    if (activeOwners.has(u.id)) continue;
    const segment: Segment = reservedOwners.has(u.id) ? "reserved" : endedOwners.has(u.id) ? "movedOut" : "neverRented";
    if (segment === "neverRented" && u.email?.toLowerCase().endsWith(STAFF_DOMAIN)) {
      staffExcluded += 1;
      continue;
    }
    customers.push({ segment, address: toText(u.address) });
  }
  return { customers, nonText, others: { available: true, usersInList: users.length, listWithAddress, staffExcluded } };
}
