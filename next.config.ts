import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/scrape-runs": [
      "./node_modules/playwright/**/*",
      "./node_modules/playwright-core/**/*",
    ],
  },
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
