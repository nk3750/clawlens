import { describe, expect, it } from "vitest";
import type { RiskTier } from "../dashboard/src/lib/types";
import { worstMeaningfulTier } from "../dashboard/src/lib/utils";

function mix(partial: Partial<Record<RiskTier, number>>): Record<RiskTier, number> {
  return { low: 0, medium: 0, high: 0, critical: 0, ...partial };
}

describe("worstMeaningfulTier — compound rule", () => {
  describe("CRIT branch (any critical ≥ 1)", () => {
    it("returns 'critical' for a single critical action", () => {
      expect(worstMeaningfulTier(mix({ critical: 1 }))).toBe("critical");
    });

    it("returns 'critical' for the failure-mode fixture (low: 92, critical: 8)", () => {
      // Regression lock for the issue: the old riskTierFromScore(avgRiskScore)
      // path read this as LOW because averaging diluted 8 crits into a sub-25
      // mean. Compound rule must surface the crits as the headline.
      expect(worstMeaningfulTier(mix({ low: 92, critical: 8 }))).toBe("critical");
    });

    it("returns 'critical' even when crits are dwarfed by routine actions", () => {
      expect(worstMeaningfulTier(mix({ low: 10000, medium: 500, high: 100, critical: 1 }))).toBe(
        "critical",
      );
    });
  });

  describe("HIGH branch (high ≥ 2, no crit)", () => {
    it("returns 'high' for exactly 2 high actions", () => {
      // Boundary case: the threshold itself triggers HIGH.
      expect(worstMeaningfulTier(mix({ low: 100, high: 2 }))).toBe("high");
    });

    it("returns 'high' when high count is well above the threshold", () => {
      expect(worstMeaningfulTier(mix({ low: 50, high: 20 }))).toBe("high");
    });

    it("does NOT return 'high' for exactly 1 high action — single-call noise filter", () => {
      // Spec §4 design lock: 1 high in a busy day reads as MED (or LOW if no
      // med share threshold met). The count label handles the inspection cue.
      expect(worstMeaningfulTier(mix({ low: 100, high: 1 }))).toBe("low");
    });

    it("returns 'medium' when 1 high is paired with med ≥ 5% (med wins by share)", () => {
      // 1 high doesn't promote on its own, but 5% med share does. Confirms the
      // rules are independent, not nested.
      const m = mix({ low: 90, medium: 5, high: 1 });
      expect(worstMeaningfulTier(m)).toBe("medium");
    });
  });

  describe("MED branch (medium share ≥ 5%, no crit, high < 2)", () => {
    it("returns 'medium' at exactly 5% medium share (boundary)", () => {
      // 5 / 100 = 0.05 — the threshold itself triggers MED.
      expect(worstMeaningfulTier(mix({ low: 95, medium: 5 }))).toBe("medium");
    });

    it("returns 'low' just under the 5% threshold (4.99% — boundary -)", () => {
      // 4 / 100 = 0.04 → no promote.
      expect(worstMeaningfulTier(mix({ low: 96, medium: 4 }))).toBe("low");
    });

    it("returns 'medium' when medium share dominates", () => {
      expect(worstMeaningfulTier(mix({ low: 50, medium: 50 }))).toBe("medium");
    });
  });

  describe("LOW branch (default)", () => {
    it("returns 'low' for an empty mix", () => {
      expect(worstMeaningfulTier(mix({}))).toBe("low");
    });

    it("returns 'low' for an all-low agent", () => {
      expect(worstMeaningfulTier(mix({ low: 234 }))).toBe("low");
    });

    it("returns 'low' for total = 0 (no scored actions)", () => {
      expect(worstMeaningfulTier({ low: 0, medium: 0, high: 0, critical: 0 })).toBe("low");
    });
  });

  describe("priority cascade — crit > high > med > low", () => {
    it("crit beats high (5 high + 1 crit → CRIT)", () => {
      expect(worstMeaningfulTier(mix({ low: 50, high: 5, critical: 1 }))).toBe("critical");
    });

    it("high beats med (10 med + 2 high → HIGH)", () => {
      expect(worstMeaningfulTier(mix({ low: 50, medium: 10, high: 2 }))).toBe("high");
    });

    it("med beats low (95 low + 5 med → MED)", () => {
      expect(worstMeaningfulTier(mix({ low: 95, medium: 5 }))).toBe("medium");
    });
  });

  describe("denominator — total = sum(mix), not extrinsic count", () => {
    it("uses sum(mix) as the share denominator (5/95 ≈ 5.0% triggers MED)", () => {
      // 95 + 5 = 100, 5 / 100 = 0.05. Verified above; this duplicates to make the
      // denominator-source explicit.
      expect(worstMeaningfulTier(mix({ low: 95, medium: 5 }))).toBe("medium");
    });
  });
});
