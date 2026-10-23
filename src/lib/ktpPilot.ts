import { ensureSchema, query } from "./db";
import { hasValue, ID_CUSTOM_FIELD, shapeOf } from "./idCheck";
import { readKtp } from "./ktpOcr";
import { loadRegionData, maskNik, parseNik } from "./nik";
import { fetchStoreganiseFile, fetchUserById, paginate } from "./storeganise";

export const PILOT_SAMPLE_SIZE = 50;

export type PilotStatus = "ok" | "no_nik" | "passport" | "unsupported_format" | "download_failed" | "unsupported_field";
export type PilotVerdict = "correct" | "wrong";

export type PilotRow = {
  id: number;
  tenantName: string;
  status: PilotStatus;
  ocrPass: string | null;
  confidence: number | null;
  nikMasked: string | null;
  birthDate: string | null;
  sex: "L" | "P" | null;
  provinceName: string | null;
  regencyName: string | null;
  regencyCode: string | null;
  detail: string | null;
  durationMs: number | null;
  verdict: PilotVerdict | null;
  processedAt: string;
};

export type PilotSummary = {
  sampleSize: number;
  processed: number;
  byStatus: Record<PilotStatus, number>;
  verified: number;
  correct: number;
  wrong: number;
  avgDurationMs: number | null;
  rows: PilotRow[];
};

// Exact-email allowlist, separate from dashboard login: the pilot shows
// KTP-derived data, so it's limited to whoever is named here.
export function isPilotAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.PILOT_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

// The File field's exact shape isn't documented anywhere we could read. Only
// absolute URLs are followed — a bare file ID would need a Storeganise
// endpoint we haven't confirmed, so it's reported (with its shape) rather
// than guessed at.
function resolveFileUrl(value: unknown): string | null {
  if (Array.isArray(value)) return value.length > 0 ? resolveFileUrl(value[0]) : null;
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? value : null;
  if (value && typeof value === "object") {
    for (const key of ["url", "href", "src", "location", "downloadUrl", "link"]) {
      const v = (value as Record<string, unknown>)[key];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }
  }
  return null;
}

type DbRow = {
  id: number;
  tenant_name: string;
  status: PilotStatus;
  ocr_pass: string | null;
  confidence: number | null;
  nik_masked: string | null;
  birth_date: string | null;
  sex: "L" | "P" | null;
  province_code: string | null;
  regency_code: string | null;
  detail: string | null;
  duration_ms: number | null;
  verdict: PilotVerdict | null;
  processed_at: string;
};

const SELECT_COLUMNS = `id, tenant_name, status, ocr_pass, confidence, nik_masked, to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
  sex, province_code, regency_code, detail, duration_ms, verdict, processed_at`;

async function toView(rows: DbRow[]): Promise<PilotRow[]> {
  const { provinces, regencies } = await loadRegionData();
  return rows.map((r) => ({
    id: r.id,
    tenantName: r.tenant_name,
    status: r.status,
    ocrPass: r.ocr_pass,
    confidence: r.confidence,
    nikMasked: r.nik_masked,
    birthDate: r.birth_date,
    sex: r.sex,
    provinceName: r.province_code ? (provinces.get(r.province_code) ?? null) : null,
    regencyName: r.regency_code ? (regencies.get(r.regency_code) ?? null) : null,
    regencyCode: r.regency_code,
    detail: r.detail,
    durationMs: r.duration_ms,
    verdict: r.verdict,
    processedAt: new Date(r.processed_at).toISOString(),
  }));
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const MAX_CANDIDATE_ATTEMPTS = 20;

// Picks one random active tenant with an uploaded ID who isn't in the sample
// yet, reads it, and records only the derived result. Returns null once the
// sample is full.
export async function processNextSample(processedBy: string): Promise<PilotRow | null> {
  await ensureSchema();
  const done = await query<{ owner_id: string }>("SELECT owner_id FROM ktp_ocr_pilot");
  if (done.length >= PILOT_SAMPLE_SIZE) return null;
  const doneIds = new Set(done.map((r) => r.owner_id));

  const rentals = await paginate<{ ownerId: string; owner?: { name?: string } }>(
    "/v1/admin/unit-rentals?state=occupied&include=owner"
  );
  const nameById = new Map(rentals.map((r) => [r.ownerId, r.owner?.name]));
  const candidates = shuffle(Array.from(nameById.keys()).filter((id) => !doneIds.has(id)));

  for (const ownerId of candidates.slice(0, MAX_CANDIDATE_ATTEMPTS)) {
    let value: unknown;
    let userName: string | undefined;
    try {
      const user = await fetchUserById(ownerId, { include: "customFields" });
      value = user.customFields?.[ID_CUSTOM_FIELD];
      userName = user.name;
    } catch {
      continue;
    }
    if (!hasValue(value)) continue;
    return processOne(ownerId, nameById.get(ownerId) ?? userName ?? ownerId, value, processedBy);
  }
  throw new Error("Tidak menemukan tenant aktif dengan KTP/paspor yang belum masuk sampel.");
}

async function processOne(ownerId: string, tenantName: string, value: unknown, processedBy: string): Promise<PilotRow> {
  const started = Date.now();
  const fields: Partial<Omit<DbRow, "id" | "tenant_name" | "processed_at">> & { status: PilotStatus } = { status: "no_nik" };

  const url = resolveFileUrl(value);
  if (!url) {
    fields.status = "unsupported_field";
    fields.detail = `Bentuk field belum didukung: ${shapeOf(value)}`;
  } else {
    let bytes: Buffer | null = null;
    try {
      bytes = (await fetchStoreganiseFile(url)).bytes;
    } catch (err) {
      fields.status = "download_failed";
      fields.detail = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    }
    if (bytes) {
      const result = await readKtp(bytes);
      fields.status = result.status;
      fields.confidence = result.confidence;
      if (result.status === "ok") {
        const parsed = parseNik(result.nik)!;
        fields.ocr_pass = result.pass;
        fields.nik_masked = maskNik(result.nik);
        fields.birth_date = parsed.birthDate;
        fields.sex = parsed.sex;
        fields.province_code = parsed.provinceCode;
        fields.regency_code = parsed.regencyCode;
      }
    }
  }

  const inserted = await query<DbRow>(
    `INSERT INTO ktp_ocr_pilot
       (owner_id, tenant_name, status, ocr_pass, confidence, nik_masked, birth_date, sex, province_code, regency_code, detail, duration_ms, processed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (owner_id) DO NOTHING
     RETURNING ${SELECT_COLUMNS}`,
    [
      ownerId,
      tenantName,
      fields.status,
      fields.ocr_pass ?? null,
      fields.confidence ?? null,
      fields.nik_masked ?? null,
      fields.birth_date ?? null,
      fields.sex ?? null,
      fields.province_code ?? null,
      fields.regency_code ?? null,
      fields.detail ?? null,
      Date.now() - started,
      processedBy,
    ]
  );
  // A concurrent request may have sampled the same tenant first.
  const row = inserted[0] ?? (await query<DbRow>(`SELECT ${SELECT_COLUMNS} FROM ktp_ocr_pilot WHERE owner_id = $1`, [ownerId]))[0];
  return (await toView([row]))[0];
}

export async function setVerdict(id: number, verdict: PilotVerdict | null, verifiedBy: string): Promise<boolean> {
  await ensureSchema();
  const rows = await query<{ id: number }>(
    `UPDATE ktp_ocr_pilot SET verdict = $2, verified_by = $3, verified_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
     WHERE id = $1 AND status = 'ok' RETURNING id`,
    [id, verdict, verdict ? verifiedBy : null]
  );
  return rows.length > 0;
}

export async function getPilotSummary(): Promise<PilotSummary> {
  await ensureSchema();
  const rows = await toView(await query<DbRow>(`SELECT ${SELECT_COLUMNS} FROM ktp_ocr_pilot ORDER BY processed_at DESC`));
  const byStatus: Record<PilotStatus, number> = {
    ok: 0,
    no_nik: 0,
    passport: 0,
    unsupported_format: 0,
    download_failed: 0,
    unsupported_field: 0,
  };
  for (const r of rows) byStatus[r.status] += 1;
  // Only files that actually went through OCR — instant failures (bad field,
  // 404, non-image) would drag the average down.
  const durations = rows
    .filter((r) => r.status === "ok" || r.status === "no_nik" || r.status === "passport")
    .map((r) => r.durationMs)
    .filter((d): d is number => d !== null);
  const correct = rows.filter((r) => r.verdict === "correct").length;
  const wrong = rows.filter((r) => r.verdict === "wrong").length;
  return {
    sampleSize: PILOT_SAMPLE_SIZE,
    processed: rows.length,
    byStatus,
    verified: correct + wrong,
    correct,
    wrong,
    avgDurationMs: durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null,
    rows,
  };
}
