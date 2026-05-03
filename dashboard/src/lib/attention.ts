import type { EntryResponse } from "./types";

/**
 * SSE-stream predicate that gates `/api/attention` refetches. Returns true
 * when an entry could change the attention response — i.e. it matches one
 * of the four backend `getAttention` branches in
 * `src/dashboard/api.ts:949-1112`, OR is a resolution event that should
 * drop a previously-listed item from the inbox.
 *
 * Branches (cheap structural checks first; numeric last):
 *   1. `decision === "approval_required"` — pending branch
 *      (api.ts:1005-1010). Keys off the RAW field because
 *      `getEffectiveDecision` coerces an unresolved approval_required to
 *      "allow" under observe-mode (api.ts:338) — eff alone can never see
 *      this case.
 *   2. `userResponse` truthy — resolution event (approved / denied /
 *      timeout). Backend's `resolvedToolCallIds` set (api.ts:973) drops
 *      these from `pending`, so the inbox only shrinks if we refetch.
 *   3. `effectiveDecision === "block"` — blocked branch (api.ts:1049).
 *   4. `effectiveDecision === "timeout"` — timeout branch (api.ts:1049).
 *   5. `params.guardrailAction === "allow_notify"` — allow_notify branch
 *      (api.ts:1064-1068). Type-narrowed via `typeof` since `params` is
 *      `Record<string, unknown>` (types.ts:131).
 *   6. `riskScore >= 65` — high_risk branch (api.ts:1090). The 65 mirrors
 *      `HIGH_RISK_THRESHOLD` at api.ts:697 — it's not exported and adding
 *      a cross-package import for one number isn't worth the path. Keep in
 *      sync if the backend constant moves.
 */
export function shouldRefetchAttention(entry: EntryResponse): boolean {
  if (entry.decision === "approval_required") return true;
  if (entry.userResponse) return true;
  if (entry.effectiveDecision === "block") return true;
  if (entry.effectiveDecision === "timeout") return true;
  if (
    typeof entry.params.guardrailAction === "string" &&
    entry.params.guardrailAction === "allow_notify"
  ) {
    return true;
  }
  if ((entry.riskScore ?? 0) >= 65) return true;
  return false;
}
