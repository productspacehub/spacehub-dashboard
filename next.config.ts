import type { NextConfig } from "next";

// tesseract.js spawns its OCR worker from a file path computed at runtime and
// loads its wasm core and language data the same way, so the bundler can't
// follow them: keep it a plain Node require, and list everything it loads.
const OCR_RUNTIME_FILES = [
  "./node_modules/tesseract.js/**/*",
  "./node_modules/tesseract.js-core/**/*",
  "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**/*",
  "./node_modules/{bmp-js,idb-keyval,is-url,node-fetch,whatwg-url,tr46,webidl-conversions,regenerator-runtime,wasm-feature-detect,zlibjs}/**/*",
  "./node_modules/idn-area-data/data/{provinces,regencies}.csv",
  "./node_modules/papaparse/**/*",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["tesseract.js", "idn-area-data"],
  outputFileTracingIncludes: {
    "/api/id-check/pilot": OCR_RUNTIME_FILES,
    "/api/id-check/pilot/*": OCR_RUNTIME_FILES,
  },
};

export default nextConfig;
