import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  output: "standalone",
  serverExternalPackages: ["pg", "pg-native"],
};

export default nextConfig;
