import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // idn-area-data reads its CSV files from a path computed at runtime, which
  // the bundler can't follow: keep it a plain Node require and ship the files.
  serverExternalPackages: ["idn-area-data"],
  outputFileTracingIncludes: {
    "/api/address-profile": [
      "./node_modules/idn-area-data/data/{provinces,regencies,districts}.csv",
      "./node_modules/papaparse/**/*",
    ],
  },
};

export default nextConfig;
