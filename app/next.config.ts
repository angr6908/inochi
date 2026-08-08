import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for the Docker runtime image.
  output: "standalone",
  // Next 16.3 writes AGENTS.md + CLAUDE.md into this directory on every
  // `next dev` and re-creates them if deleted, leaving a permanently dirty
  // working tree. We keep our own agent instructions, so opt out.
  agentRules: false,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:3001/api/:path*" },
      { source: "/uploads/:path*", destination: "http://localhost:3001/uploads/:path*" },
    ];
  },
};

export default nextConfig;
