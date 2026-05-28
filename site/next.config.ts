import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // The Honcho SDK calls `new URL("/v3/...", baseURL)` which discards any path
  // on the baseURL. Rewriting browser-side `/v3/...` and `/health` to our proxy
  // lets the SDK + raw client share a single same-origin entry point.
  async rewrites() {
    return [
      { source: "/v3/:path*", destination: "/api/honcho/v3/:path*" },
      { source: "/health", destination: "/api/honcho/health" },
      { source: "/openapi.json", destination: "/api/honcho/openapi.json" },
    ];
  },
};

export default nextConfig;
