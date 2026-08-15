import type { NextConfig } from "next";

/**
 * Platform-level security headers (spec section 18). This is baseline
 * protection, not complete application security — authentication-specific,
 * authorization-specific, AI-specific, and tenant-specific hardening are
 * each their own module's responsibility (04, 05, 33, 06/07).
 *
 * A real Content-Security-Policy needs to know every script/style/font
 * source the app will ever load (Anthropic streaming, GHL embeds, Google
 * Business Profile widgets, ...) which isn't knowable yet in Module 01 —
 * see docs/architecture/security.md for why CSP is deferred rather than
 * shipped as an overly permissive placeholder that gives false confidence.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
