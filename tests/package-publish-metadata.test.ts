import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for distribution-channels-spec §A/B/C: package.json publish
// identifiers. These fields are load-bearing for the ClawHub + npm publish
// pipeline. Without them:
//   - `name` (D-1): ClawHub slug and npm package name are coupled. The README's
//     `openclaw plugins install openclaw-clawlens` resolves through ClawHub-first
//     then npm. The scoped name @nk3750/openclaw-clawlens is what npm pack
//     produces and what release.yml's tarball-rename step globs.
//   - `openclaw.extensions`: plugin loader entrypoint (compiled JS, not .ts —
//     gateway loads from dist/ per CLAUDE.md).
//   - `openclaw.compat.*`: pluginApi floor + minGatewayVersion gate runtime
//     compatibility on stricter gateway versions.
//   - `openclaw.install.minHostVersion`: read at install-time to fail closed
//     before download (docs/plugins/manifest.md:509).
//   - `files`: npm publish would otherwise ship tests/, docs/, dev configs.
//   - `prepublishOnly`: belt-and-suspenders to keep dist/ fresh before publish.
describe("package.json publish metadata (distribution-channels-spec §A/B/C)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));

  it("uses the scoped npm package name @nk3750/openclaw-clawlens (D-1)", () => {
    expect(pkg.name).toBe("@nk3750/openclaw-clawlens");
  });

  it("points main at the compiled entry, not the .ts source", () => {
    // npm auto-includes whatever `main` resolves to in every published tarball,
    // regardless of the `files` allowlist. If main points at index.ts, source
    // leaks into npm. Compiled dist/index.js is the only safe target.
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.main.endsWith(".ts")).toBe(false);
  });

  it("declares the OpenClaw plugin entrypoint via openclaw.extensions", () => {
    expect(pkg.openclaw?.extensions).toEqual(["./dist/index.js"]);
  });

  it("declares minimum pluginApi compatibility", () => {
    expect(pkg.openclaw?.compat?.pluginApi).toBe(">=2026.3.24-beta.2");
  });

  it("declares minimum gateway version", () => {
    expect(pkg.openclaw?.compat?.minGatewayVersion).toBe("2026.4.0");
  });

  it("declares install-time minHostVersion (read pre-download)", () => {
    expect(pkg.openclaw?.install?.minHostVersion).toBe(">=2026.4.0");
  });

  it("ships only publish-relevant files via the files allowlist (§B)", () => {
    expect(pkg.files).toEqual([
      "dist/",
      "dashboard/dist/",
      "openclaw.plugin.json",
      "LICENSE",
      "README.md",
      "CHANGELOG.md",
    ]);
  });

  it("has a prepublishOnly script that rebuilds dist/ + dashboard before publish (§C)", () => {
    expect(pkg.scripts?.prepublishOnly).toBe(
      "npx tsc -p tsconfig.json && cd dashboard && npm run build",
    );
  });
});
