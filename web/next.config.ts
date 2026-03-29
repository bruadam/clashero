import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
  output: "standalone",
  serverExternalPackages: ["pg", "pg-native", "better-sqlite3", "canvas", "gl"],
};

export default nextConfig;
