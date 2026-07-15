import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for the Docker runtime image.
  output: "standalone",
  experimental: {
    useTypeScriptCli: true,
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:3001/api/:path*" },
      { source: "/uploads/:path*", destination: "http://localhost:3001/uploads/:path*" },
    ];
  },
};

export default nextConfig;
