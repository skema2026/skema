import type { NextConfig } from "next";
import path from "path";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: isProd ? "standalone" : undefined,
  allowedDevOrigins: ['bba1-221-141-198-104.ngrok-free.app'],
  turbopack: {
    root: path.resolve(__dirname),
  },
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
