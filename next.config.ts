import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["node-exiftool", "dist-exiftool"],
  },
  outputFileTracingIncludes: {
    "/api/iptc/write": [
      "./node_modules/dist-exiftool/**/*",
      "./node_modules/exiftool.pl/vendor/**/*",
      "./node_modules/exiftool.exe/vendor/**/*",
    ],
  },
};

export default nextConfig;
