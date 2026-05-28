import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: isProd ? "standalone" : undefined,
  allowedDevOrigins: [],
  async rewrites() {
    if (isProd) return [];
    return [
      {
        source: '/proxy/:path*',
        destination: 'http://localhost:8000/:path*',
      },
    ];
  },
};

export default nextConfig;
