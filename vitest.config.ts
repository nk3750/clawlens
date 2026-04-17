import * as path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Root vitest config. Backend tests run in node by default; .tsx tests opt in
 * to jsdom via a `// @vitest-environment jsdom` comment at the top of the
 * file (matching the existing pattern in tests/use-total-flash.test.ts).
 *
 * The resolve.alias entries collapse "react" / "react-dom" to a single copy
 * so React Testing Library and dashboard hooks share one dispatcher. Without
 * this, the dashboard's nested node_modules/react was being loaded for
 * dashboard/src/ files while the root's copy backed RTL — two dispatchers,
 * "Cannot read properties of null (reading 'useRef')" at hook call sites.
 */
export default defineConfig({
  resolve: {
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
