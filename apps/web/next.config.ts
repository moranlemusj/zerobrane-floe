import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The web app reads from Neon and from Floe's public REST. Both are remote.
  // No external image domains needed yet; revisit when we render token icons.
  // typedRoutes is nice but blocks string-built hrefs we use throughout the
  // dashboard (filter links, dynamic loan pages). Keep off until v2.
  experimental: {
    typedRoutes: false,
  },
  // @floe-* workspace packages are TypeScript source; transpile via Next.
  transpilePackages: ["@floe-agents/core", "@floe-dashboard/data"],
};

export default nextConfig;
