import path from "node:path";
import sharp, { type OutputInfo } from "sharp";
import { createWorker, PSM, type Page, type Worker } from "tesseract.js";
import { extractNik, loadRegionData } from "./nik";

export type OcrPass = "full" | "nik-line" | "rotate-90" | "rotate-270" | "rotate-180";

export type KtpOcrResult =
  | { status: "ok"; nik: string; confidence: number; pass: OcrPass }
  | { status: "passport" | "no_nik" | "unsupported_format"; confidence: number | null };

// Language data ships with the app (npm package, traced into the function
// bundle via next.config.ts) — nothing is downloaded at runtime and the image
// never leaves this server.
const LANG_PATH = path.join(process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0_best_int");
const TARGET_WIDTH = 2000;

let workerPromise: Promise<Worker> | undefined;

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker("eng", 1, { langPath: LANG_PATH, cacheMethod: "none" }).catch((err) => {
    workerPromise = undefined;
    throw err;
  });
  return workerPromise;
}

// The NIK-line pass changes worker-wide parameters, so one file's passes must
// not interleave with another request's.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

const looksLikePassport = (text: string) => /P<[A-Z<]{3}|<{5,}|PASPOR|PASSPORT/i.test(text);

function findNikLabel(page: Page) {
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          if (/^N\s*[I1l]\s*K/i.test(word.text)) return word.bbox;
        }
      }
    }
  }
  return null;
}

export async function readKtp(file: Buffer): Promise<KtpOcrResult> {
  // EXIF-orient, greyscale, normalize contrast, and bring every photo to a
  // similar width — tesseract does markedly better on upscaled small scans.
  let base: { data: Buffer; info: OutputInfo };
  try {
    base = await sharp(file, { failOn: "none" })
      .rotate()
      .grayscale()
      .normalize()
      .resize({ width: TARGET_WIDTH })
      .png()
      .toBuffer({ resolveWithObject: true });
  } catch {
    // PDF/HEIC or a corrupt file — not something this pilot handles.
    return { status: "unsupported_format", confidence: null };
  }

  const { provinces } = await loadRegionData();
  const provinceCodes = new Set(provinces.keys());
  const worker = await getWorker();

  return exclusive(async () => {
    const full = (await worker.recognize(base.data, {}, { text: true, blocks: true })).data;
    let nik = extractNik(full.text, provinceCodes);
    if (nik) return { status: "ok", nik, confidence: full.confidence, pass: "full" };
    if (looksLikePassport(full.text)) return { status: "passport", confidence: full.confidence };
    let best = full.confidence;

    const label = findNikLabel(full);
    if (label) {
      const h = label.y1 - label.y0;
      const top = Math.max(0, Math.round(label.y0 - h * 0.5));
      const rectangle = {
        left: label.x1,
        top,
        width: Math.max(1, base.info.width - label.x1),
        height: Math.min(base.info.height - top, Math.round(h * 2)),
      };
      await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: PSM.SINGLE_LINE });
      try {
        const line = (await worker.recognize(base.data, { rectangle })).data;
        nik = extractNik(`NIK ${line.text}`, provinceCodes);
        if (nik) return { status: "ok", nik, confidence: line.confidence, pass: "nik-line" };
      } finally {
        // Tesseract's own defaults (tesseract.js doesn't override them).
        await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: PSM.AUTO });
      }
    }

    // Sideways or upside-down photos that EXIF didn't fix.
    for (const angle of [90, 270, 180] as const) {
      const rotated = await sharp(base.data).rotate(angle).png().toBuffer();
      const page = (await worker.recognize(rotated)).data;
      best = Math.max(best, page.confidence);
      nik = extractNik(page.text, provinceCodes);
      if (nik) return { status: "ok", nik, confidence: page.confidence, pass: `rotate-${angle}` };
      if (looksLikePassport(page.text)) return { status: "passport", confidence: page.confidence };
    }

    return { status: "no_nik", confidence: best };
  });
}
