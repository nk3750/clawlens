import { describe, expect, it } from "vitest";
import { shouldRefetchAttention } from "../dashboard/src/lib/attention";
import type { EntryResponse } from "../dashboard/src/lib/types";

/**
 * Build a minimal EntryResponse for predicate tests. Only the fields the
 * predicate inspects are interesting — everything else is filler.
 */
function mkEntry(overrides: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: "2026-05-03T12:00:00.000Z",
    toolName: "exec",
    params: {},
    effectiveDecision: "allow",
    category: "scripts",
    ...overrides,
  };
}

describe("shouldRefetchAttention", () => {
  it("refetches on approval_required with low risk score (the headline bug)", () => {
    expect(
      shouldRefetchAttention(
        mkEntry({ decision: "approval_required", effectiveDecision: "allow", riskScore: 40 }),
      ),
    ).toBe(true);
  });

  it("refetches on approval_required with high risk score (regression guard)", () => {
    expect(
      shouldRefetchAttention(
        mkEntry({ decision: "approval_required", effectiveDecision: "allow", riskScore: 80 }),
      ),
    ).toBe(true);
  });

  it("refetches on params.guardrailAction=allow_notify even when risk is low", () => {
    expect(
      shouldRefetchAttention(
        mkEntry({
          params: { guardrailAction: "allow_notify" },
          effectiveDecision: "allow",
          riskScore: 30,
        }),
      ),
    ).toBe(true);
  });

  it("refetches on userResponse=approved (resolution event drops the inbox item)", () => {
    expect(
      shouldRefetchAttention(
        mkEntry({ userResponse: "approved", effectiveDecision: "approved", riskScore: 30 }),
      ),
    ).toBe(true);
  });

  it("refetches on userResponse=denied (resolution event)", () => {
    expect(
      shouldRefetchAttention(
        mkEntry({ userResponse: "denied", effectiveDecision: "denied", riskScore: 30 }),
      ),
    ).toBe(true);
  });

  it("refetches on effectiveDecision=block (regression guard)", () => {
    expect(shouldRefetchAttention(mkEntry({ effectiveDecision: "block", riskScore: 30 }))).toBe(
      true,
    );
  });

  it("refetches on effectiveDecision=timeout (regression guard)", () => {
    expect(shouldRefetchAttention(mkEntry({ effectiveDecision: "timeout", riskScore: 30 }))).toBe(
      true,
    );
  });

  it("refetches on high-risk allow path (eff=allow, score>=65)", () => {
    expect(shouldRefetchAttention(mkEntry({ effectiveDecision: "allow", riskScore: 80 }))).toBe(
      true,
    );
  });

  it("does NOT refetch on low-risk allow noise (would hammer /api/attention)", () => {
    expect(shouldRefetchAttention(mkEntry({ effectiveDecision: "allow", riskScore: 30 }))).toBe(
      false,
    );
  });

  it("does NOT refetch on non-attention guardrailAction (e.g. block) without other signal", () => {
    // The "block" guardrail action surfaces via eff === "block" on the
    // logDecision row. The guardrail-match row alone (params.guardrailAction
    // === "block", eff still allow) is not an attention trigger.
    expect(
      shouldRefetchAttention(
        mkEntry({
          params: { guardrailAction: "block" },
          effectiveDecision: "allow",
          riskScore: 30,
        }),
      ),
    ).toBe(false);
  });
});
