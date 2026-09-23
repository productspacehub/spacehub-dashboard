import { ensureSchema, query } from "./db";
import { jakartaToday } from "./snapshots";
import { MODULE_CONFIG, type BookingSource, type BookingStatus, type ModuleType, type PaymentStatus } from "./bookingConstants";

export { MODULE_TYPES, MODULE_LABELS, MODULE_CONFIG, BOOKING_STATUSES, PAYMENT_STATUSES, BOOKING_SOURCES } from "./bookingConstants";
export type { ModuleType, BookingStatus, PaymentStatus, BookingSource } from "./bookingConstants";

export type Customer = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  idNumber: string | null;
  notes: string | null;
};

export type CustomerInput = {
  name: string;
  phone: string;
  email?: string | null;
  idNumber?: string | null;
  notes?: string | null;
};

export type RatePackage = {
  id: number;
  packageName: string;
  price: number;
};

export type Addon = {
  id: number;
  name: string;
  price: number;
};

export type BookingAddon = {
  name: string;
  price: number;
  quantity: number;
};

export type ContainerRow = {
  id: number;
  label: string;
  status: "Free" | "Assigned";
  currentBookingId: number | null;
  currentCustomerName: string | null;
};

export type BookingListItem = {
  id: number;
  moduleType: ModuleType;
  customerName: string;
  customerPhone: string;
  packageType: string;
  startDate: string;
  endDate: string | null;
  price: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  containerLabel: string | null;
  createdAt: string;
  // Active past its end date (Jakarta calendar day) — derived at read time,
  // not stored, same reasoning as Container's Free/Assigned status: it can
  // never drift out of sync with the booking row, and "today" naturally
  // advances on its own without any scheduled job to keep it current.
  isOverdue: boolean;
};

export type BookingDetail = BookingListItem & {
  customer: Customer;
  containerId: number | null;
  paymentReference: string | null;
  source: BookingSource;
  createdBy: string | null;
  notes: string | null;
  addons: BookingAddon[];
};

export type BookingCounts = Record<BookingStatus, number>;

function emptyCounts(): BookingCounts {
  return {
    "Pending Payment": 0,
    Confirmed: 0,
    Active: 0,
    Completed: 0,
    Cancelled: 0,
    "No-Show": 0,
  };
}

// --- Customers ---------------------------------------------------------

export async function searchCustomers(q: string): Promise<Customer[]> {
  await ensureSchema();
  const term = q.trim();
  if (!term) {
    const rows = await query<CustomerRow>(
      `SELECT id, name, phone, email, id_number, notes FROM customers ORDER BY created_at DESC LIMIT 20`
    );
    return rows.map(mapCustomer);
  }
  const rows = await query<CustomerRow>(
    `SELECT id, name, phone, email, id_number, notes FROM customers
     WHERE phone ILIKE $1 OR name ILIKE $1
     ORDER BY created_at DESC LIMIT 20`,
    [`%${term}%`]
  );
  return rows.map(mapCustomer);
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  await ensureSchema();
  const rows = await query<CustomerRow>(
    `INSERT INTO customers (name, phone, email, id_number, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, phone, email, id_number, notes`,
    [input.name.trim(), input.phone.trim(), input.email?.trim() || null, input.idNumber?.trim() || null, input.notes?.trim() || null]
  );
  return mapCustomer(rows[0]);
}

type CustomerRow = { id: number; name: string; phone: string; email: string | null; id_number: string | null; notes: string | null };
function mapCustomer(row: CustomerRow): Customer {
  return { id: row.id, name: row.name, phone: row.phone, email: row.email, idNumber: row.id_number, notes: row.notes };
}

// --- Rate packages (admin-editable, §5.2) -------------------------------

export async function getRatePackages(moduleType: ModuleType): Promise<RatePackage[]> {
  await ensureSchema();
  const rows = await query<{ id: number; package_name: string; price: string }>(
    `SELECT id, package_name, price FROM rate_packages WHERE module_type = $1 ORDER BY package_name ASC`,
    [moduleType]
  );
  return rows.map((r) => ({ id: r.id, packageName: r.package_name, price: Number(r.price) }));
}

// Replaces the whole rate table for a module in one go: upserts every row
// passed in, deletes any existing row not present in the new list. Simple
// admin-managed table (per spec recommendation) — no separate add/rename/
// delete endpoints needed for a handful of package rows.
export async function setRatePackages(packages: { packageName: string; price: number }[], moduleType: ModuleType): Promise<RatePackage[]> {
  await ensureSchema();
  const names = packages.map((p) => p.packageName.trim()).filter(Boolean);
  for (const pkg of packages) {
    const name = pkg.packageName.trim();
    if (!name) continue;
    await query(
      `INSERT INTO rate_packages (module_type, package_name, price)
       VALUES ($1, $2, $3)
       ON CONFLICT (module_type, package_name) DO UPDATE SET price = EXCLUDED.price, updated_at = now()`,
      [moduleType, name, pkg.price]
    );
  }
  if (names.length > 0) {
    await query(`DELETE FROM rate_packages WHERE module_type = $1 AND package_name <> ALL($2::text[])`, [moduleType, names]);
  } else {
    await query(`DELETE FROM rate_packages WHERE module_type = $1`, [moduleType]);
  }
  return getRatePackages(moduleType);
}

// --- Addons (admin-editable menu, e.g. Co-working's water/TV/lockers) ------
// Same shape and same "replace the whole list" pattern as rate packages —
// booking_addons below stores a name+price snapshot per selection, not a
// foreign key, so renaming/repricing/removing an addon here never changes
// what an already-made booking shows.

export async function getAddons(moduleType: ModuleType): Promise<Addon[]> {
  await ensureSchema();
  const rows = await query<{ id: number; name: string; price: string }>(
    `SELECT id, name, price FROM addons WHERE module_type = $1 ORDER BY name ASC`,
    [moduleType]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, price: Number(r.price) }));
}

export async function setAddons(addons: { name: string; price: number }[], moduleType: ModuleType): Promise<Addon[]> {
  await ensureSchema();
  const names = addons.map((a) => a.name.trim()).filter(Boolean);
  for (const addon of addons) {
    const name = addon.name.trim();
    if (!name) continue;
    await query(
      `INSERT INTO addons (module_type, name, price)
       VALUES ($1, $2, $3)
       ON CONFLICT (module_type, name) DO UPDATE SET price = EXCLUDED.price, updated_at = now()`,
      [moduleType, name, addon.price]
    );
  }
  if (names.length > 0) {
    await query(`DELETE FROM addons WHERE module_type = $1 AND name <> ALL($2::text[])`, [moduleType, names]);
  } else {
    await query(`DELETE FROM addons WHERE module_type = $1`, [moduleType]);
  }
  return getAddons(moduleType);
}

async function getBookingAddons(bookingId: number): Promise<BookingAddon[]> {
  const rows = await query<{ addon_name: string; price: string; quantity: number }>(
    `SELECT addon_name, price, quantity FROM booking_addons WHERE booking_id = $1 ORDER BY addon_name ASC`,
    [bookingId]
  );
  return rows.map((r) => ({ name: r.addon_name, price: Number(r.price), quantity: r.quantity }));
}

async function replaceBookingAddons(bookingId: number, addons: BookingAddon[]): Promise<void> {
  await query(`DELETE FROM booking_addons WHERE booking_id = $1`, [bookingId]);
  for (const addon of addons) {
    const name = addon.name.trim();
    const quantity = Math.floor(addon.quantity);
    if (!name || !Number.isFinite(quantity) || quantity < 1) continue;
    await query(`INSERT INTO booking_addons (booking_id, addon_name, price, quantity) VALUES ($1, $2, $3, $4)`, [
      bookingId,
      name,
      addon.price,
      quantity,
    ]);
  }
}

// --- Containers (shared_storage only — no per-unit resource for other modules) --

// A container's status is derived, not stored: "Assigned" iff some booking
// with status = Active currently references it. This keeps container state
// always consistent with booking state instead of needing a second place to
// update whenever a booking's status changes.
async function containerRows(where: string, params: unknown[]): Promise<ContainerRow[]> {
  const rows = await query<{
    id: number;
    label: string;
    booking_id: number | null;
    customer_name: string | null;
  }>(
    `SELECT c.id, c.label, b.id AS booking_id, cu.name AS customer_name
     FROM containers c
     LEFT JOIN bookings b ON b.container_id = c.id AND b.status = 'Active'
     LEFT JOIN customers cu ON cu.id = b.customer_id
     ${where}
     ORDER BY c.label ASC`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    status: r.booking_id ? "Assigned" : "Free",
    currentBookingId: r.booking_id,
    currentCustomerName: r.customer_name,
  }));
}

export async function listContainers(q?: string): Promise<ContainerRow[]> {
  await ensureSchema();
  const term = q?.trim();
  if (!term) return containerRows("", []);
  return containerRows("WHERE c.label ILIKE $1", [`%${term}%`]);
}

export async function getFreeContainers(): Promise<ContainerRow[]> {
  await ensureSchema();
  const rows = await containerRows("", []);
  return rows.filter((r) => r.status === "Free");
}

export async function createContainer(label: string): Promise<ContainerRow> {
  await ensureSchema();
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Container ID wajib diisi");
  await query(`INSERT INTO containers (label) VALUES ($1)`, [trimmed]);
  const rows = await containerRows("WHERE c.label = $1", [trimmed]);
  return rows[0];
}

// --- Headcount (co_working — availability is informational only in the MVP) --

// Counts bookings whose date range covers today, regardless of whether an
// end_date was given (an open-ended booking still counts as occupying a
// seat today). Informational only, per the module's spec — nothing here
// blocks creating another booking even if this number looks "full".
export async function getActiveHeadcountToday(moduleType: ModuleType): Promise<number> {
  await ensureSchema();
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE module_type = $1 AND status = 'Active'
       AND start_date <= CURRENT_DATE
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
    [moduleType]
  );
  return Number(rows[0].count);
}

// --- Bookings --------------------------------------------------------------

const LIST_SELECT = `
  SELECT b.id, b.module_type, cu.name AS customer_name, cu.phone AS customer_phone, b.package_type,
         to_char(b.start_date, 'YYYY-MM-DD') AS start_date,
         to_char(b.end_date, 'YYYY-MM-DD') AS end_date,
         b.price, b.status, b.payment_status, co.label AS container_label,
         b.created_at
  FROM bookings b
  JOIN customers cu ON cu.id = b.customer_id
  LEFT JOIN containers co ON co.id = b.container_id
`;

type ListRow = {
  id: number;
  module_type: ModuleType;
  customer_name: string;
  customer_phone: string;
  package_type: string;
  start_date: string;
  end_date: string | null;
  price: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  container_label: string | null;
  created_at: string;
};

function mapListRow(r: ListRow, today: string): BookingListItem {
  return {
    id: r.id,
    moduleType: r.module_type,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    packageType: r.package_type,
    startDate: r.start_date,
    endDate: r.end_date,
    price: Number(r.price),
    status: r.status,
    paymentStatus: r.payment_status,
    containerLabel: r.container_label,
    createdAt: r.created_at,
    isOverdue: r.status === "Active" && r.end_date !== null && r.end_date < today,
  };
}

export async function listBookings(filters: {
  moduleType: ModuleType;
  status?: BookingStatus;
  q?: string;
}): Promise<{ bookings: BookingListItem[]; counts: BookingCounts }> {
  await ensureSchema();
  const conditions = [`b.module_type = $1`];
  const params: unknown[] = [filters.moduleType];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`b.status = $${params.length}`);
  }
  if (filters.q?.trim()) {
    params.push(`%${filters.q.trim()}%`);
    conditions.push(`(cu.name ILIKE $${params.length} OR cu.phone ILIKE $${params.length})`);
  }

  const rows = await query<ListRow>(`${LIST_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY b.created_at DESC`, params);

  const countRows = await query<{ status: BookingStatus; count: string }>(
    `SELECT status, COUNT(*) AS count FROM bookings WHERE module_type = $1 GROUP BY status`,
    [filters.moduleType]
  );
  const counts = emptyCounts();
  for (const row of countRows) counts[row.status] = Number(row.count);

  const today = jakartaToday();
  return { bookings: rows.map((r) => mapListRow(r, today)), counts };
}

// Not module-scoped: booking ids are unique across the whole table, and the
// detail page adapts its own rendering based on the returned moduleType.
export async function getBooking(id: number): Promise<BookingDetail | null> {
  await ensureSchema();
  const rows = await query<
    ListRow & {
      container_id: number | null;
      payment_reference: string | null;
      source: BookingSource;
      created_by: string | null;
      notes: string | null;
      cu_id: number;
      cu_email: string | null;
      cu_id_number: string | null;
      cu_notes: string | null;
    }
  >(
    `SELECT b.id, b.module_type, cu.name AS customer_name, cu.phone AS customer_phone, b.package_type,
            to_char(b.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(b.end_date, 'YYYY-MM-DD') AS end_date,
            b.price, b.status, b.payment_status, co.label AS container_label,
            b.created_at, b.container_id, b.payment_reference, b.source, b.created_by, b.notes,
            cu.id AS cu_id, cu.email AS cu_email, cu.id_number AS cu_id_number, cu.notes AS cu_notes
     FROM bookings b
     JOIN customers cu ON cu.id = b.customer_id
     LEFT JOIN containers co ON co.id = b.container_id
     WHERE b.id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const addons = await getBookingAddons(id);
  return {
    ...mapListRow(r, jakartaToday()),
    customer: { id: r.cu_id, name: r.customer_name, phone: r.customer_phone, email: r.cu_email, idNumber: r.cu_id_number, notes: r.cu_notes },
    containerId: r.container_id,
    paymentReference: r.payment_reference,
    source: r.source,
    createdBy: r.created_by,
    notes: r.notes,
    addons,
  };
}

export type CreateBookingInput = {
  moduleType: ModuleType;
  customerId?: number;
  newCustomer?: CustomerInput;
  packageType: string;
  startDate: string;
  endDate?: string | null;
  price: number;
  source: BookingSource;
  addons?: BookingAddon[];
  notes?: string | null;
  createdBy?: string | null;
};

export async function createBooking(input: CreateBookingInput): Promise<BookingDetail> {
  await ensureSchema();
  if (!input.customerId && !input.newCustomer) {
    throw new Error("Pilih customer yang sudah ada atau isi data customer baru");
  }

  const customerId = input.customerId ?? (await createCustomer(input.newCustomer!)).id;

  const rows = await query<{ id: number }>(
    `INSERT INTO bookings (customer_id, module_type, package_type, start_date, end_date, price, source, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      customerId,
      input.moduleType,
      input.packageType,
      input.startDate,
      input.endDate || null,
      input.price,
      input.source,
      input.notes?.trim() || null,
      input.createdBy || null,
    ]
  );
  const bookingId = rows[0].id;

  if (input.addons?.length) {
    await replaceBookingAddons(bookingId, input.addons);
  }

  return (await getBooking(bookingId))!;
}

export type UpdateBookingInput = {
  customer?: CustomerInput;
  packageType?: string;
  startDate?: string;
  endDate?: string | null;
  price?: number;
  paymentStatus?: PaymentStatus;
  paymentReference?: string | null;
  status?: BookingStatus;
  containerId?: number | null;
  addons?: BookingAddon[];
  notes?: string | null;
};

// Applies an edit to a booking, enforcing the invariants the spec calls out
// (§5.3/§5.4), which differ slightly by module (see MODULE_CONFIG):
// - Paying a Pending Payment booking auto-advances it — to Confirmed for
//   shared_storage (still needs a container assigned at drop-off), straight
//   to Active for co_working (nothing else to wait for).
// - A container can only be assigned (moving to Active) if it isn't already
//   Assigned to another Active booking — only checked for modules that use
//   containers at all.
export async function updateBooking(id: number, patch: UpdateBookingInput): Promise<BookingDetail> {
  await ensureSchema();
  const existing = await getBooking(id);
  if (!existing) throw new Error("Booking tidak ditemukan");
  const config = MODULE_CONFIG[existing.moduleType];

  if (patch.customer) {
    await query(
      `UPDATE customers SET name = $1, phone = $2, email = $3, id_number = $4, notes = $5 WHERE id = $6`,
      [
        patch.customer.name.trim(),
        patch.customer.phone.trim(),
        patch.customer.email?.trim() || null,
        patch.customer.idNumber?.trim() || null,
        patch.customer.notes?.trim() || null,
        existing.customer.id,
      ]
    );
  }

  let nextStatus = patch.status ?? existing.status;
  const nextPaymentStatus = patch.paymentStatus ?? existing.paymentStatus;
  if (patch.paymentStatus === "Paid" && existing.status === "Pending Payment" && !patch.status) {
    nextStatus = config.autoActivateOnPayment ? "Active" : "Confirmed";
  }

  let nextContainerId = patch.containerId !== undefined ? patch.containerId : existing.containerId;

  if (nextStatus === "Active" && config.requiresContainer) {
    if (!nextContainerId) {
      throw new Error("Pilih container yang tersedia dulu sebelum mengubah status ke Active");
    }
    if (nextContainerId !== existing.containerId) {
      const free = await getFreeContainers();
      if (!free.some((c) => c.id === nextContainerId)) {
        throw new Error("Container ini sedang Assigned ke booking lain");
      }
    }
  }
  if (nextStatus !== "Active" && patch.containerId === undefined) {
    // Leaving Active for any other status releases the container automatically
    // (status is derived from the booking row, so no extra bookkeeping needed) —
    // but keep the historical container_id on the row itself for traceability.
    nextContainerId = existing.containerId;
  }

  const fields: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    params.push(value);
    fields.push(`${col} = $${params.length}`);
  };

  set("package_type", patch.packageType ?? existing.packageType);
  set("start_date", patch.startDate ?? existing.startDate);
  set("end_date", patch.endDate !== undefined ? patch.endDate || null : existing.endDate);
  set("price", patch.price ?? existing.price);
  set("payment_status", nextPaymentStatus);
  set("payment_reference", patch.paymentReference !== undefined ? patch.paymentReference || null : existing.paymentReference);
  set("status", nextStatus);
  set("container_id", nextContainerId);
  set("notes", patch.notes !== undefined ? patch.notes || null : existing.notes);
  set("updated_at", new Date().toISOString());
  params.push(id);

  await query(`UPDATE bookings SET ${fields.join(", ")} WHERE id = $${params.length}`, params);

  if (patch.addons !== undefined) {
    await replaceBookingAddons(id, patch.addons);
  }

  return (await getBooking(id))!;
}
