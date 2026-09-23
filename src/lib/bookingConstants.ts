// Pure constants/types shared between server code (src/lib/bookings.ts,
// which also imports the Postgres client) and client components. Kept in a
// separate module with no server-only imports so client pages can pull in
// these enums without bundling `pg` into the browser build.

// module_type values live on the shared bookings/rate_packages/addons tables
// (§4 of the booking MVP spec — deliberately module-agnostic so a new module
// only adds config here, never a schema change).
export const MODULE_TYPES = ["shared_storage", "co_working", "meeting_room", "studio"] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

export const MODULE_LABELS: Record<ModuleType, string> = {
  shared_storage: "Shared Storage",
  co_working: "Co-working",
  meeting_room: "Meeting Room",
  studio: "Studio",
};

// Where the four modules' booking lifecycle/fields actually differ:
// - shared_storage: Confirmed -> Active only happens when admin assigns a
//   Free container at drop-off (a real physical event to wait for).
// - co_working: availability is a headcount check, not a per-unit resource,
//   so there's nothing to wait for after payment — paying jumps straight to
//   Active instead of stopping at Confirmed.
// - meeting_room / studio: booked by time slot (§7.2), not just a date — a
//   room is picked and its schedule checked for conflicts up front, at
//   creation, not deferred to an Active-transition gate like Container. So
//   they behave like shared_storage for the payment->status transition
//   (stop at Confirmed — there's no "the meeting is happening now" trigger
//   worth automating), but need usesTimeSlots for the extra fields/checks.
// minBookingHours is a business decision, not a technical constraint — kept
// here as plain config (rather than hardcoded in the validation logic) so it
// can be tuned per module as the business monitors real usage, with no code
// change beyond this number. null means no minimum is enforced.
export const MODULE_CONFIG: Record<
  ModuleType,
  { requiresContainer: boolean; autoActivateOnPayment: boolean; usesTimeSlots: boolean; minBookingHours: number | null }
> = {
  shared_storage: { requiresContainer: true, autoActivateOnPayment: false, usesTimeSlots: false, minBookingHours: null },
  co_working: { requiresContainer: false, autoActivateOnPayment: true, usesTimeSlots: false, minBookingHours: null },
  meeting_room: { requiresContainer: false, autoActivateOnPayment: false, usesTimeSlots: true, minBookingHours: 3 },
  studio: { requiresContainer: false, autoActivateOnPayment: false, usesTimeSlots: true, minBookingHours: 3 },
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
