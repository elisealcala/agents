import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ingest-classifier"],
  async headers() {
    return [
      "/manager/:path*",
      "/login",
      "/api/auth/:path*",
      "/api/manager/:path*",
      "/api/manager-migration",
      "/api/manager-backup",
      "/api/manager-backup/latest",
    ].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    }));
  },
};

export default nextConfig;
