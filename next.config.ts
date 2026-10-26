import type { NextConfig } from "next";

// idn-area-data reads its CSV files from a path computed at runtime, which
// the bundler can't follow: keep it a plain Node require and ship the files
// with every route that loads the region index.
const REGION_DATA_FILES = [
  "./node_modules/idn-area-data/data/{provinces,regencies,districts}.csv",
  "./node_modules/papaparse/**/*",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["idn-area-data"],
  outputFileTracingIncludes: {
    "/api/address-profile": REGION_DATA_FILES,
    "/api/address-mapping": REGION_DATA_FILES,
    "/api/address-mapping/*": REGION_DATA_FILES,
  },
};

export default nextConfig;
