import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/scrape-runs": [
      "./node_modules/playwright/**/*",
      "./node_modules/playwright-core/**/*",
    ],
    "/api/sales-scrape": [
      "./node_modules/playwright-core/**/*",
    ],
    "/api/royalties-scrape": [
      "./node_modules/playwright-core/**/*",
    ],
    "/api/internal/flexepos/sales": [
      "./node_modules/playwright-core/**/*",
    ],
    "/api/internal/flexepos/royalties": [
      "./node_modules/playwright-core/**/*",
    ],
  },
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
