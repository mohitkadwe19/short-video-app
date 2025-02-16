import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb', // Increase the body size limit to 2MB
    },
  },
};

export default nextConfig;
