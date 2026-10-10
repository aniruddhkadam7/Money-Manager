import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project (a stray lockfile exists in the home folder).
  turbopack: { root: path.resolve(__dirname) },
  // Dev only: let a phone on the same network (iPhone hotspot or home Wi-Fi) use the dev server, live reload included.
  allowedDevOrigins: ["172.20.10.*", "192.168.*.*"],
};

export default nextConfig;
