import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Build LinkedIn data at build time; pages read JSON from data/ via fs.
  // No images optimization needed for V1 (no remote images).
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
