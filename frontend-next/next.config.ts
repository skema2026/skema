import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: isProd ? "standalone" : undefined,

  async rewrites() {
    const internalUrl =
      process.env.INTERNAL_API_URL ||
      (isProd ? "http://backend:8000" : "http://localhost:8000");

    return [
      {
        source: "/proxy/:path*",
        destination: `${internalUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;