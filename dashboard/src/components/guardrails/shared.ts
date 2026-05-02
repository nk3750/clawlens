import type { Guardrail, GuardrailAction, RiskTier, Target } from "../../lib/types";
import { riskTierFromScore } from "../../lib/utils";

export type ResourceKind = "file" | "exec" | "url" | "advanced";

/**
 * Map a backend target.kind to the UX-facing resourceKind. "advanced" is the
 * fallback for identity-glob — the kind the Activity-row modal emits but that
 * this page doesn't expose as a creatable / editable kind.
 */
export function resourceKindFromTarget(target: Target): ResourceKind {
  switch (target.kind) {
    case "path-glob":
      return "file";
    case "command-glob":
      return "exec";
    case "url-glob":
      return "url";
    case "identity-glob":
      return "advanced";
  }
}

/**
 * Verb library per resource kind. Names match `selector.tools.values` 1:1 —
 * a chip toggle PATCHes the exact string. Sourced from the v1 matcher's
 * extractor surface: file names from extractPathsForGuardrail, URL names
 * from extractUrlsForGuardrail (src/guardrails/identity.ts:208 / :236).
 * Adding names not handled by the extractor would create rules that never
 * fire — see guardrails-phase-2-ui-spec §0.2 for rationale.
 */
export const VERB_LIBRARY: Record<Exclude<ResourceKind, "advanced">, string[]> = {
  file: ["read", "write", "edit", "find", "grep", "ls", "apply_patch"],
  exec: ["exec"],
  url: ["web_fetch", "fetch_url", "browser"],
};

/**
 * Display metadata for the three actions. allow_notify uses --cl-info so the
 * page matches the chip color the operator already sees on every Activity /
 * RiskPanel row that mentions decisions (spec §0.1).
 */
export const ACTION_META: Record<
  GuardrailAction,
  { label: string; mono: string; color: string }
> = {
  block: { label: "Block", mono: "BLOCK", color: "var(--cl-risk-high)" },
  require_approval: {
    label: "Require Approval",
    mono: "REQUIRE APPROVAL",
    color: "var(--cl-risk-medium)",
  },
  allow_notify: { label: "Allow + Notify", mono: "ALLOW + NOTIFY", color: "var(--cl-info)" },
};

export interface Filters {
  /** "global" | agentId | null (all three resolve to selector.agent === null when comparing). */
  agent?: string | null;
  action?: GuardrailAction;
  /** identity-glob ("advanced") is intentionally NOT a filter option (§5.4). */
  kind?: Exclude<ResourceKind, "advanced">;
  tier?: RiskTier;
}

export function applyFilters(rules: Guardrail[], filters: Filters): Guardrail[] {
  return rules.filter((r) => {
    if (filters.agent !== undefined) {
      const wantsGlobal = filters.agent === "global" || filters.agent === null;
      if (wantsGlobal) {
        if (r.selector.agent !== null) return false;
      } else if (r.selector.agent !== filters.agent) {
        return false;
      }
    }
    if (filters.action !== undefined && r.action !== filters.action) return false;
    if (filters.kind !== undefined) {
      const kind = resourceKindFromTarget(r.target);
      if (kind === "advanced") return false; // identity-glob excluded from any kind filter
      if (kind !== filters.kind) return false;
    }
    if (filters.tier !== undefined) {
      if (riskTierFromScore(r.riskScore) !== filters.tier) return false;
    }
    return true;
  });
}

export function computeCounts(rules: Guardrail[]): {
  agent: Record<string, number>;
  action: Record<GuardrailAction, number>;
  kind: Record<ResourceKind, number>;
  tier: Record<RiskTier, number>;
} {
  const agent: Record<string, number> = {};
  const action: Record<GuardrailAction, number> = {
    block: 0,
    require_approval: 0,
    allow_notify: 0,
  };
  const kind: Record<ResourceKind, number> = { file: 0, exec: 0, url: 0, advanced: 0 };
  const tier: Record<RiskTier, number> = { low: 0, medium: 0, high: 0, critical: 0 };

  for (const r of rules) {
    const agentKey = r.selector.agent ?? "global";
    agent[agentKey] = (agent[agentKey] ?? 0) + 1;
    action[r.action]++;
    kind[resourceKindFromTarget(r.target)]++;
    tier[riskTierFromScore(r.riskScore)]++;
  }
  return { agent, action, kind, tier };
}

/**
 * Truncate a string from the middle with an ellipsis. Keeps both ends visible
 * — operators want to see the trailing filename AND know which root the path
 * comes from. No-op when the string already fits within `max`.
 */
export function shortPath(s: string, max: number): string {
  if (s.length <= max) return s;
  const ellipsis = "…";
  const half = Math.max(1, Math.floor((max - ellipsis.length) / 2));
  return `${s.slice(0, half)}${ellipsis}${s.slice(s.length - half)}`;
}
