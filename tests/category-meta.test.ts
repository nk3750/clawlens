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
