import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `server-only`/`client-only` are marker packages: importing them under
 * plain Node (no Next.js bundler in the loop) throws immediately by
 * design — Next's webpack/Turbopack build sets up special module
 * conditions to no-op them server-side and hard-fail them client-side.
 * Vitest runs in plain Node, so every file that imports "server-only"
 * (most of lib/, config/environment.ts) would throw on import during
 * tests without this alias. Pointing both packages at a no-op stub here
 * reproduces Next's server-side behavior for test purposes; it does NOT
 * relax the actual client-bundle protection, which is enforced by Next's
 * build, not by this file.
 */
export default defineConfig({
  test: {
    environment: "node",
    // Component tests (`.test.tsx`) opt into jsdom per-file via a
    // `// @vitest-environment jsdom` docblock — the global default stays
    // "node" so the existing plain-logic suite (config/lib/security) keeps
    // its fast, dependency-free environment unchanged.
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    setupFiles: ["tests/setup/jsdom-matchers.ts"],
  },
  resolve: {
    // Native replacement for the `vite-tsconfig-paths` plugin — resolves
    // the `@/*` alias from tsconfig.json without an extra dependency.
    tsconfigPaths: true,
    alias: {
      "server-only": path.resolve(__dirname, "tests/setup/noop-module.ts"),
      "client-only": path.resolve(__dirname, "tests/setup/noop-module.ts"),
    },
  },
});
