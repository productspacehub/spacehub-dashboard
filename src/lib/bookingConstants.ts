// Pure constants/types shared between server code (src/lib/bookings.ts,
// which also imports the Postgres client) and client components. Kept in a
// separate module with no server-only imports so client pages can pull in
// these enums without bundling `pg` into the browser build.

// module_type values live on the shared bookings/rate_packages/addons tables
// (§4 of the booking MVP spec — deliberately module-agnostic so a new module
// only adds config here, never a schema change). meeting_room/studio are
// reserved for when those modules are scoped in detail.
export const MODULE_TYPES = ["shared_storage", "co_working"] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

export const MODULE_LABELS: Record<ModuleType, string> = {
  shared_storage: "Shared Storage",
  co_working: "Co-working",
};

// Where the two modules' booking lifecycle actually differs:
// - shared_storage: Confirmed -> Active only happens when admin assigns a
//   Free container at drop-off (a real physical event to wait for).
// - co_working: availability is a headcount check, not a per-unit resource,
//   so there's nothing to wait for after payment — paying jumps straight to
//   Active instead of stopping at Confirmed.
export const MODULE_CONFIG: Record<ModuleType, { requiresContainer: boolean; autoActivateOnPayment: boolean }> = {
  shared_storage: { requiresContainer: true, autoActivateOnPayment: false },
  co_working: { requiresContainer: false, autoActivateOnPayment: true },
};

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
