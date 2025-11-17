import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["node-exiftool", "dist-exiftool"],
  },
  outputFileTracingIncludes: {
    "/app/api/iptc/write/route": [
      "./node_modules/dist-exiftool/**/*",
      "./node_modules/dist-exiftool/node_modules/exiftool.pl/vendor/**/*",
      "./node_modules/exiftool.pl/vendor/**/*",
      "./node_modules/exiftool.exe/vendor/**/*",
    ],
  },
};

export default nextConfig;
