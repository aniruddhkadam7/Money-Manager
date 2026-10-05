import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project (a stray lockfile exists in the home folder).
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
