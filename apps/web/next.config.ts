import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The web app reads from Neon and from Floe's public REST. Both are remote.
  // No external image domains needed yet; revisit when we render token icons.
  experimental: {
    typedRoutes: true,
  },
  // @floe-* workspace packages are TypeScript source; transpile via Next.
  transpilePackages: ["@floe-agents/core", "@floe-dashboard/data"],
};

export default nextConfig;
