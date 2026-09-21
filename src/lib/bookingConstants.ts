// Pure constants/types shared between server code (src/lib/bookings.ts,
// which also imports the Postgres client) and client components. Kept in a
// separate module with no server-only imports so client pages can pull in
// these enums without bundling `pg` into the browser build.

export const ACTIVE_MODULE_TYPE = "shared_storage";

export const BOOKING_STATUSES = [
  "Pending Payment",
  "Confirmed",
  "Active",
  "Completed",
  "Cancelled",
  "No-Show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_STATUSES = ["Unpaid", "Paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const BOOKING_SOURCES = ["Online Inquiry", "Walk-in"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];
