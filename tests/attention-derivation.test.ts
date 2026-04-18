import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { deriveAgentAttention, getAttention } from "../src/dashboard/api";
import { AttentionStore } from "../src/dashboard/attention-state";

// NOTE: we freeze "now" inside each suite so the 24h / 30m / 10-min windows
// are deterministic. Entry timestamps are chosen to sit well inside the window.
const NOW_ISO = "2026-04-17T12:00:00.000Z";
const NOW_MS = new Date(NOW_ISO).getTime();

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: NOW_ISO,
    toolName: "exec",
    params: {},
    prevHash: "0",
    hash: "h",
    ...overrides,
  };
}

function tmpStore(): AttentionStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-attn-deriv-"));
  const file = path.join(dir, "attention.jsonl");
  return new AttentionStore(file);
}

describe("deriveAgentAttention — block_cluster rule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires on 2 blocks within 10 minutes", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 9 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_1",
        riskScore: 82,
      }),
      entry({
        timestamp: new Date(NOW_MS - 3 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_2",
        riskScore: 70,
      }),
    ];
    const result = deriveAgentAttention(entries, undefined, undefined, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("block_cluster");
    expect(result[0].agentId).toBe("alpha");
    expect(result[0].triggerCount).toBe(2);
    // Latest block wins as triggerAt (re-raise on follow-up).
    expect(result[0].triggerAt).toBe(entries[1].timestamp);
  });

  it("does NOT fire on a single isolated block", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 5 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_1",
      }),
    ];
    expect(deriveAgentAttention(entries, undefined, undefined, NOW_MS)).toHaveLength(0);
  });

  it("does NOT fire when 2 blocks are more than 10 min apart", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 20 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_1",
      }),
      entry({
        timestamp: new Date(NOW_MS - 5 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_2",
      }),
    ];
    expect(deriveAgentAttention(entries, undefined, undefined, NOW_MS)).toHaveLength(0);
  });

  it("excludes blocks older than the 24h window", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 30 * 3600_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_1",
      }),
      entry({
        timestamp: new Date(NOW_MS - 29 * 3600_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_2",
      }),
    ];
    expect(deriveAgentAttention(entries, undefined, undefined, NOW_MS)).toHaveLength(0);
  });

  it("kills the stale `baddie` case: 0 activity today + 1 old block = no row", () => {
    // 3 days ago — well outside the 24h window. Even a single old block is
    // irrelevant; the new rules require 2+ recent events.
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 3 * 86400_000).toISOString(),
        decision: "block",
        agentId: "baddie",
        toolCallId: "tc_old",
      }),
    ];
    expect(deriveAgentAttention(entries, undefined, undefined, NOW_MS)).toHaveLength(0);
  });
});

describe("deriveAgentAttention — high_risk_cluster rule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires on 3 unguarded high-risk allows within 20 minutes", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 18 * 60_000).toISOString(),
        decision: "allow",
        agentId: "seo",
        toolCallId: "tc_1",
        riskScore: 70,
      }),
      entry({
        timestamp: new Date(NOW_MS - 10 * 60_000).toISOString(),
        decision: "allow",
        agentId: "seo",
        toolCallId: "tc_2",
        riskScore: 72,
      }),
      entry({
        timestamp: new Date(NOW_MS - 2 * 60_000).toISOString(),
        decision: "allow",
        agentId: "seo",
        toolCallId: "tc_3",
        riskScore: 68,
      }),
    ];
    const result = deriveAgentAttention(entries, undefined, undefined, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("high_risk_cluster");
    expect(result[0].triggerCount).toBe(3);
  });

  it("does NOT fire on 2 high-risk allows (need 3+)", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 10 * 60_000).toISOString(),
        decision: "allow",
        agentId: "seo",
        toolCallId: "tc_1",
        riskScore: 70,
      }),
      entry({
        timestamp: new Date(NOW_MS - 2 * 60_000).toISOString(),
        decision: "allow",
        agentId: "seo",
        toolCallId: "tc_2",
        riskScore: 72,
      }),
    ];
    expect(deriveAgentAttention(entries, undefined, undefined, NOW_MS)).toHaveLength(0);
  });

  it("does NOT fire for allows below the 65 threshold", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 18 * 60_000).toISOString(),
        decision: "allow",
        agentId: "seo",
        toolCallId: "tc_1",
        riskScore: 50,
      }),
      entry({
        timestamp: new Date(NOW_MS - 10 * 60_000).toISOString(),
        decision: "allow",
        agentId: "seo",
        toolCallId: "tc_2",
        riskScore: 40,
      }),
      entry({
        timestamp: new Date(NOW_MS - 2 * 60_000).toISOString(),
        decision: "allow",
        agentId: "seo",
        toolCallId: "tc_3",
        riskScore: 60,
      }),
    ];
    expect(deriveAgentAttention(entries, undefined, undefined, NOW_MS)).toHaveLength(0);
  });

  it("uses LLM-adjusted scores when present (eval entry)", () => {
    // Tier-1 says 30, LLM eval bumps to 80. Cluster should fire.
    const mkPair = (iso: string, tcid: string): AuditEntry[] => [
      entry({
        timestamp: iso,
        decision: "allow",
        agentId: "seo",
        toolCallId: tcid,
        riskScore: 30,
      }),
      entry({
        timestamp: iso,
        toolName: "exec",
        refToolCallId: tcid,
        llmEvaluation: {
          adjustedScore: 80,
          reasoning: "r",
          tags: [],
          confidence: "c",
          patterns: [],
        },
      }),
    ];
    const entries: AuditEntry[] = [
      ...mkPair(new Date(NOW_MS - 15 * 60_000).toISOString(), "tc_1"),
      ...mkPair(new Date(NOW_MS - 8 * 60_000).toISOString(), "tc_2"),
      ...mkPair(new Date(NOW_MS - 3 * 60_000).toISOString(), "tc_3"),
    ];
    const result = deriveAgentAttention(entries, undefined, undefined, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("high_risk_cluster");
  });
});

describe("deriveAgentAttention — sustained_elevation rule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires when session avg > 50 and >= 10 actions", () => {
    const entries: AuditEntry[] = [];
    for (let i = 0; i < 12; i++) {
      entries.push(
        entry({
          timestamp: new Date(NOW_MS - (15 - i) * 60_000).toISOString(),
          decision: "allow",
          agentId: "gamma",
          toolCallId: `tc_${i}`,
          riskScore: 55,
          sessionKey: "gamma:cron:job-001",
        }),
      );
    }
    const result = deriveAgentAttention(entries, undefined, undefined, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("sustained_elevation");
    expect(result[0].triggerCount).toBe(12);
    expect(result[0].lastSessionKey).toBe("gamma:cron:job-001");
  });

  it("does NOT fire with fewer than 10 actions, even at high avg", () => {
    // Scores are 55 — above the sustained_elevation avg (>50) but below the
    // high_risk cluster threshold (>=65). This isolates the rule we're testing.
    const entries: AuditEntry[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(
        entry({
          timestamp: new Date(NOW_MS - (5 - i) * 60_000).toISOString(),
          decision: "allow",
          agentId: "gamma",
          toolCallId: `tc_${i}`,
          riskScore: 55,
          sessionKey: "gamma:main",
        }),
      );
    }
    expect(deriveAgentAttention(entries, undefined, undefined, NOW_MS)).toHaveLength(0);
  });

  it("does NOT fire when the session average is at or below 50", () => {
    const entries: AuditEntry[] = [];
    for (let i = 0; i < 12; i++) {
      entries.push(
        entry({
          timestamp: new Date(NOW_MS - (15 - i) * 60_000).toISOString(),
          decision: "allow",
          agentId: "gamma",
          toolCallId: `tc_${i}`,
          riskScore: 50,
          sessionKey: "gamma:main",
        }),
      );
    }
    expect(deriveAgentAttention(entries, undefined, undefined, NOW_MS)).toHaveLength(0);
  });
});

describe("deriveAgentAttention — ack filtering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides agents whose latest trigger is covered by an ack", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 9 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_1",
      }),
      entry({
        timestamp: new Date(NOW_MS - 3 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_2",
      }),
    ];
    const triggerAt = entries[1].timestamp;
    const store = tmpStore();
    store.append({
      id: AttentionStore.generateId(),
      scope: { kind: "agent", agentId: "alpha", upToIso: triggerAt },
      ackedAt: new Date(NOW_MS).toISOString(),
      action: "ack",
    });
    expect(deriveAgentAttention(entries, undefined, store, NOW_MS)).toHaveLength(0);
  });

  it("also hides agents with legacy action='dismiss' records (backward compat — #6)", () => {
    // The on-disk schema still accepts "dismiss" for rows written before the
    // verb was collapsed; any existing ack record must hide regardless of verb.
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 9 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_1",
      }),
      entry({
        timestamp: new Date(NOW_MS - 3 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_2",
      }),
    ];
    const triggerAt = entries[1].timestamp;
    const store = tmpStore();
    store.append({
      id: AttentionStore.generateId(),
      scope: { kind: "agent", agentId: "alpha", upToIso: triggerAt },
      ackedAt: new Date(NOW_MS).toISOString(),
      action: "dismiss",
    });
    expect(deriveAgentAttention(entries, undefined, store, NOW_MS)).toHaveLength(0);
  });

  it("re-raises an agent when a newer trigger arrives after the ack", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 15 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_1",
      }),
      entry({
        timestamp: new Date(NOW_MS - 12 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_2",
      }),
    ];
    const firstTrigger = entries[1].timestamp;
    const store = tmpStore();
    store.append({
      id: AttentionStore.generateId(),
      scope: { kind: "agent", agentId: "alpha", upToIso: firstTrigger },
      ackedAt: firstTrigger,
      action: "dismiss",
    });
    // First run: dismissed, so nothing.
    expect(deriveAgentAttention(entries, undefined, store, NOW_MS)).toHaveLength(0);

    // New block comes in AFTER the ack — re-raises the row.
    entries.push(
      entry({
        timestamp: new Date(NOW_MS - 2 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_3",
      }),
    );
    const result = deriveAgentAttention(entries, undefined, store, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0].triggerAt).toBe(entries[2].timestamp);
  });
});

describe("getAttention — T1 / T2a / T3 assembly", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces pending approvals as T1 with a timeoutMs countdown", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 60_000).toISOString(),
        decision: "approval_required",
        agentId: "alpha",
        toolCallId: "tc_pending",
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.pending).toHaveLength(1);
    expect(resp.pending[0].toolCallId).toBe("tc_pending");
    // Timeout is APPROVAL_TIMEOUT_MS (5m) minus elapsed (1m) = 4m = 240_000ms.
    expect(resp.pending[0].timeoutMs).toBe(240_000);
  });

  it("surfaces blocked entries as T2a with kind='blocked'", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 60 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_blocked",
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.blocked).toHaveLength(1);
    expect(resp.blocked[0].kind).toBe("blocked");
    expect(resp.blocked[0].toolCallId).toBe("tc_blocked");
  });

  it("ages out T2a rows older than 24h", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 25 * 3600_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_old",
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.blocked).toHaveLength(0);
  });

  it("surfaces unguarded high-risk allows as T3 within 30 min", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 10 * 60_000).toISOString(),
        decision: "allow",
        agentId: "alpha",
        toolCallId: "tc_high",
        riskScore: 70,
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.highRisk).toHaveLength(1);
    expect(resp.highRisk[0].kind).toBe("high_risk");
    expect(resp.highRisk[0].toolCallId).toBe("tc_high");
  });

  it("ages out T3 rows older than 30 min", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 45 * 60_000).toISOString(),
        decision: "allow",
        agentId: "alpha",
        toolCallId: "tc_old_high",
        riskScore: 70,
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.highRisk).toHaveLength(0);
  });

  it("hides both acked and legacy-dismissed entries (single-verb semantics — #6)", () => {
    // Both on-disk actions hide the row: new writes use "ack", existing
    // "dismiss" records stay functional without migration.
    const store = tmpStore();
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 60 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_legacy_dismiss",
      }),
      entry({
        timestamp: new Date(NOW_MS - 30 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_acked",
      }),
      entry({
        timestamp: new Date(NOW_MS - 10 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_untouched",
      }),
    ];
    const ackedAt = new Date(NOW_MS).toISOString();
    store.append({
      id: AttentionStore.generateId(),
      scope: { kind: "entry", toolCallId: "tc_legacy_dismiss" },
      ackedAt,
      action: "dismiss",
    });
    store.append({
      id: AttentionStore.generateId(),
      scope: { kind: "entry", toolCallId: "tc_acked" },
      ackedAt,
      action: "ack",
    });
    const resp = getAttention(entries, undefined, store, NOW_MS);
    expect(resp.blocked).toHaveLength(1);
    expect(resp.blocked[0].toolCallId).toBe("tc_untouched");
  });

  it("sorts pending by timeoutMs ascending (most urgent first)", () => {
    const entries: AuditEntry[] = [
      entry({
        // Newer approval — longer timeout remaining.
        timestamp: new Date(NOW_MS - 30_000).toISOString(),
        decision: "approval_required",
        agentId: "alpha",
        toolCallId: "tc_fresh",
      }),
      entry({
        // Older — about to time out.
        timestamp: new Date(NOW_MS - 240_000).toISOString(),
        decision: "approval_required",
        agentId: "alpha",
        toolCallId: "tc_almost_out",
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.pending.map((p) => p.toolCallId)).toEqual(["tc_almost_out", "tc_fresh"]);
  });
});

describe("getAttention — split session key resolution (#10)", () => {
  // SESSION_GAP_MS = 30 min → a gap >30 min splits a session into #2, #3, ...
  // Each test below arranges two runs sharing a raw sessionKey; the attention
  // item's emitted sessionKey must carry the #N suffix of the run containing
  // the flagged entry. Pre-fix the raw key is emitted instead — that's the bug.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("remaps a pending approval's sessionKey to the #N sub-session it belongs to", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 60 * 60_000).toISOString(), // 1h ago — run 1
        decision: "allow",
        agentId: "alpha",
        toolCallId: "tc_run1",
        sessionKey: "alpha:main",
        riskScore: 10,
      }),
      entry({
        timestamp: new Date(NOW_MS - 60_000).toISOString(), // 1m ago — run 2 (59m gap)
        decision: "approval_required",
        agentId: "alpha",
        toolCallId: "tc_run2_pending",
        sessionKey: "alpha:main",
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.pending).toHaveLength(1);
    expect(resp.pending[0].toolCallId).toBe("tc_run2_pending");
    expect(resp.pending[0].sessionKey).toBe("alpha:main#2");
  });

  it("remaps a blocked entry's sessionKey to the #N sub-session it belongs to", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 120 * 60_000).toISOString(), // 2h ago — run 1
        decision: "allow",
        agentId: "alpha",
        toolCallId: "tc_run1",
        sessionKey: "alpha:main",
        riskScore: 10,
      }),
      entry({
        timestamp: new Date(NOW_MS - 60 * 60_000).toISOString(), // 1h ago — run 2 (60m gap)
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_run2_blocked",
        sessionKey: "alpha:main",
        riskScore: 80,
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.blocked).toHaveLength(1);
    expect(resp.blocked[0].toolCallId).toBe("tc_run2_blocked");
    expect(resp.blocked[0].sessionKey).toBe("alpha:main#2");
  });

  it("remaps a high-risk allow's sessionKey to the #N sub-session it belongs to", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 60 * 60_000).toISOString(), // 1h ago — run 1
        decision: "allow",
        agentId: "alpha",
        toolCallId: "tc_run1",
        sessionKey: "alpha:main",
        riskScore: 10,
      }),
      entry({
        timestamp: new Date(NOW_MS - 5 * 60_000).toISOString(), // 5m ago — run 2 (55m gap)
        decision: "allow",
        agentId: "alpha",
        toolCallId: "tc_run2_highrisk",
        sessionKey: "alpha:main",
        riskScore: 75,
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.highRisk).toHaveLength(1);
    expect(resp.highRisk[0].toolCallId).toBe("tc_run2_highrisk");
    expect(resp.highRisk[0].sessionKey).toBe("alpha:main#2");
  });
});

describe("deriveAgentAttention — split session key resolution (#10)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns lastSessionKey with the #N suffix for the latest run", () => {
    // Run 1 at T-2h (a single block) + run 2 at T-5m/T-3m (a 2-block cluster in
    // a ≤10-min window). 115-min gap between runs → groupBySessions splits run
    // 2 into "alpha:main#2". block_cluster fires on run 2; lastSessionKey must
    // carry the #2 suffix so the agent-row "view session" link lands on run 2.
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 120 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_run1",
        sessionKey: "alpha:main",
      }),
      entry({
        timestamp: new Date(NOW_MS - 5 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_run2a",
        sessionKey: "alpha:main",
      }),
      entry({
        timestamp: new Date(NOW_MS - 3 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_run2b",
        sessionKey: "alpha:main",
      }),
    ];
    const result = deriveAgentAttention(entries, undefined, undefined, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("block_cluster");
    expect(result[0].lastSessionKey).toBe("alpha:main#2");
  });
});

describe("getAttention — LLM-absent risk fallback (spec addendum)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces a Tier-1-only high-risk entry in T3 even when no LLM eval exists", () => {
    // Real-world production: LLM call failed (billing/rate-limit/outage). The
    // entry still carries Tier-1 riskScore / riskTier — T3 must still fire.
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 5 * 60_000).toISOString(),
        decision: "allow",
        agentId: "alpha",
        toolCallId: "tc_no_eval",
        riskScore: 82,
        riskTier: "critical",
      }),
    ];
    const resp = getAttention(entries, undefined, undefined, NOW_MS);
    expect(resp.highRisk).toHaveLength(1);
    expect(resp.highRisk[0].toolCallId).toBe("tc_no_eval");
    expect(resp.highRisk[0].riskScore).toBe(82);
  });
});
