import * as path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Root vitest config. Backend tests run in node by default; .tsx tests opt in
 * to jsdom via a `// @vitest-environment jsdom` comment at the top of the
 * file (matching the existing pattern in tests/use-total-flash.test.ts).
 *
 * `@vitejs/plugin-react` enables the automatic JSX runtime so .tsx files
 * don't have to import React explicitly — matches how the dashboard itself
 * builds.
 *
 * The resolve.alias entries collapse react / react-dom / react-router-dom to
 * a single copy so RTL, router contexts, and dashboard hooks all share one
 * dispatcher. Without this, the dashboard's nested node_modules/react was
 * being loaded for dashboard/src/ files while the root's copy backed RTL —
 * two dispatchers, "Cannot read properties of null (reading 'useRef')" at
 * hook call sites.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react-router-dom": path.resolve(__dirname, "node_modules/react-router-dom"),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
