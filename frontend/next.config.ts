import type { NextConfig } from "next";

/**
 * The browser only ever talks to its own origin. `/api/v1/*` is proxied to the
 * backend so that the auth cookies stay first-party (SameSite=lax), which is
 * what lets the app work unchanged across localhost, a Vercel+HuggingFace
 * split, and a single-domain deployment.
 *
 * BACKEND_ORIGIN is read at build time on Vercel and defaults to the local API
 * in development, so local and production share one code path.
 */
const backendOrigin =
  process.env.BACKEND_ORIGIN?.replace(/\/+$/, "") ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
