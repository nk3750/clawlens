// CATEGORY_META is the single source of truth for ActivityCategory display.
// These assertions lock the canonical short-lowercase label form so drift
// back to verbose labels (e.g. "Making changes", "Web & APIs") fails CI.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_META } from "../dashboard/src/lib/utils";

describe("CATEGORY_META.label", () => {
  it("uses the short lowercase form for every ActivityCategory", () => {
    expect(CATEGORY_META.exploring.label).toBe("exploring");
    expect(CATEGORY_META.changes.label).toBe("changes");
    expect(CATEGORY_META.git.label).toBe("git");
    expect(CATEGORY_META.scripts.label).toBe("scripts");
    expect(CATEGORY_META.web.label).toBe("web");
    expect(CATEGORY_META.comms.label).toBe("comms");
    expect(CATEGORY_META.orchestration.label).toBe("orchestration");
    expect(CATEGORY_META.media.label).toBe("media");
  });
});

// Token names must match bucket names. Spec: agent-card-polish §1 renames
// `--cl-cat-commands` → `--cl-cat-git` and `--cl-cat-data` → `--cl-cat-scripts`
// so a reader doesn't have to remember which bucket consumes which legacy hue.
describe("CATEGORY_META.color — token names match bucket names", () => {
  it("git bucket references --cl-cat-git", () => {
    expect(CATEGORY_META.git.color).toBe("var(--cl-cat-git)");
  });

  it("scripts bucket references --cl-cat-scripts", () => {
    expect(CATEGORY_META.scripts.color).toBe("var(--cl-cat-scripts)");
  });

  it("the four other buckets keep their existing token names", () => {
    expect(CATEGORY_META.exploring.color).toBe("var(--cl-cat-exploring)");
    expect(CATEGORY_META.changes.color).toBe("var(--cl-cat-changes)");
    expect(CATEGORY_META.web.color).toBe("var(--cl-cat-web)");
    expect(CATEGORY_META.comms.color).toBe("var(--cl-cat-comms)");
  });

  it("orchestration and media reference their own --cl-cat-* tokens", () => {
    expect(CATEGORY_META.orchestration.color).toBe("var(--cl-cat-orchestration)");
    expect(CATEGORY_META.media.color).toBe("var(--cl-cat-media)");
  });

  it("every CATEGORY_META.color resolves to a --cl-cat-* token (no risk-token, no hardcoded hex)", () => {
    for (const meta of Object.values(CATEGORY_META)) {
      expect(meta.color).toMatch(/^var\(--cl-cat-[a-z]+\)$/);
    }
  });
});

// Spec: agent-card-polish §1 — risk reserves the warm-to-green spectrum;
// categories must not share a hex value with any risk token. Reading the
// CSS file directly keeps this guard load-bearing across future palette
// shifts (a value swap that re-introduces collision will fail here in CI
// without anyone needing to remember the rule).
describe("category palette — no hex-value overlap with risk palette", () => {
  function tokenMap(css: string): Record<string, string> {
    // Parse `--token-name: #hex;` pairs in :root. Permissive whitespace; we
    // only care about the 6 cat + 4 risk lines, all of which use plain hex.
    const out: Record<string, string> = {};
    const root = css.match(/:root\s*\{([\s\S]*?)\}/);
    if (!root) throw new Error("Could not find :root block in index.css");
    const re = /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
    let m: RegExpExecArray | null;
    m = re.exec(root[1]);
    while (m !== null) {
      out[m[1]] = m[2].toLowerCase();
      m = re.exec(root[1]);
    }
    return out;
  }

  it("uses the bolder cool/magenta palette (Option A — Tailwind 500-band)", () => {
    // Spec: agent-card-polish #14 follow-up — the prior 400-band pastels
    // crowded the cool/magenta hue space and let `changes`/`scripts` blur,
    // and `web`/`comms` blur. Bumping to 500-band saturated values opens
    // visible separation between every adjacent pair while still keeping
    // every value off the risk spectrum (no warm-to-green).
    const cssPath = path.resolve(__dirname, "..", "dashboard", "src", "index.css");
    const css = fs.readFileSync(cssPath, "utf8");
    const tokens = tokenMap(css);
    expect(tokens["cl-cat-exploring"]).toBe("#3b82f6"); // blue-500
    expect(tokens["cl-cat-changes"]).toBe("#8b5cf6"); // violet-500
    expect(tokens["cl-cat-git"]).toBe("#ec4899"); // pink-500
    expect(tokens["cl-cat-web"]).toBe("#06b6d4"); // cyan-500
    expect(tokens["cl-cat-comms"]).toBe("#14b8a6"); // teal-500
    expect(tokens["cl-cat-scripts"]).toBe("#a855f7"); // purple-500
    expect(tokens["cl-cat-orchestration"]).toBe("#6366f1"); // indigo-500
    expect(tokens["cl-cat-media"]).toBe("#d946ef"); // fuchsia-500
  });

  it("category and risk hex sets are disjoint", () => {
    const cssPath = path.resolve(__dirname, "..", "dashboard", "src", "index.css");
    const css = fs.readFileSync(cssPath, "utf8");
    const tokens = tokenMap(css);

    const catNames = [
      "cl-cat-exploring",
      "cl-cat-changes",
      "cl-cat-git",
      "cl-cat-web",
      "cl-cat-comms",
      "cl-cat-scripts",
      "cl-cat-orchestration",
      "cl-cat-media",
    ];
    const riskNames = ["cl-risk-low", "cl-risk-medium", "cl-risk-high", "cl-risk-critical"];

    // Sanity: every token resolved.
    for (const name of [...catNames, ...riskNames]) {
      expect(tokens[name], `expected ${name} in :root`).toBeDefined();
    }

    const catHex = catNames.map((n) => tokens[n]);
    const riskHex = new Set(riskNames.map((n) => tokens[n]));

    for (const name of catNames) {
      expect(
        riskHex.has(tokens[name]),
        `${name} (${tokens[name]}) collides with a risk token`,
      ).toBe(false);
    }

    // Bonus: cat values are themselves unique.
    expect(new Set(catHex).size).toBe(catHex.length);
  });
});
