import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
  serverExternalPackages: ["pg", "pg-native", "better-sqlite3", "canvas", "gl"],
};

export default nextConfig;
