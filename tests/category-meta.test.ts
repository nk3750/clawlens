// CATEGORY_META is the single source of truth for ActivityCategory display.
// These assertions lock the canonical short-lowercase label form so drift
// back to verbose labels (e.g. "Making changes", "Web & APIs") fails CI.

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

  it("every CATEGORY_META.color resolves to a --cl-cat-* token (no risk-token, no hardcoded hex)", () => {
    for (const meta of Object.values(CATEGORY_META)) {
      expect(meta.color).toMatch(/^var\(--cl-cat-[a-z]+\)$/);
    }
  });
});
