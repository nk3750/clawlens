// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no EventSource. FleetHeader wires useSSEStatus which constructs one
// when stats data is present, so stub a minimal shim before the component mounts.
class EventSourceShim {
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0;
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.stubGlobal("EventSource", EventSourceShim);

/**
 * Mock useLiveApi so we can assert which paths Agents.tsx subscribes to and
 * exercise the attention filter predicate independently of the network/SSE
 * layer. Also mock useApi (for any nested-component subscriptions like
 * ActivityTimeline) so the homepage renders without booting EventSource.
 */
vi.mock("../dashboard/src/hooks/useLiveApi", () => ({
  useLiveApi: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useApi", () => ({
  useApi: vi.fn(() => ({ data: null, loading: false, error: null, refetch: vi.fn() })),
}));
vi.mock("../dashboard/src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));

import { useLiveApi } from "../dashboard/src/hooks/useLiveApi";
import type { AgentInfo, EntryResponse, RiskTier } from "../dashboard/src/lib/types";
import Agents from "../dashboard/src/pages/Agents";

const mockedUseLiveApi = vi.mocked(useLiveApi);

function defaultLiveApiReturn() {
  return {
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function fakeEntry(overrides: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: "2026-04-18T12:00:00.000Z",
    toolName: "exec",
    params: {},
    effectiveDecision: "allow",
    decision: "allow",
    riskScore: 30,
    // bare exec (no params.command) routes to the scripts fallback.
    category: "scripts",
    ...overrides,
  };
}

beforeEach(() => {
  mockedUseLiveApi.mockImplementation(() => defaultLiveApiReturn());
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderHome() {
  return render(
    <MemoryRouter>
      <Agents />
    </MemoryRouter>,
  );
}

describe("Agents homepage — useLiveApi subscriptions", () => {
  it("subscribes to five homepage endpoints via useLiveApi", () => {
    // Phase 2 stage B dropped the /api/guardrails subscription along with the
    // OverflowMenu that consumed its count. Guardrails management still lives
    // on /guardrails and wires its own fetch there. #23 added the two
    // FleetRiskTile aggregate endpoints so its sparkline + hero refresh on
    // SSE arrivals instead of going stale at page-load.
    renderHome();
    const paths = mockedUseLiveApi.mock.calls.map((call) => call[0]);
    expect(paths).toContain("api/stats");
    expect(paths).toContain("api/agents");
    // attention path includes optional ?date= suffix; today (default) has none.
    expect(paths.some((p) => p.startsWith("api/attention"))).toBe(true);
    // fleet-activity carries a query string (range=24h&...); fleet-risk-index is bare.
    expect(paths.some((p) => p.startsWith("api/fleet-activity"))).toBe(true);
    expect(paths).toContain("api/fleet-risk-index");
    expect(paths).not.toContain("api/guardrails");
    expect(paths).toHaveLength(5);
  });

  it("passes a filter predicate only on the attention subscription", () => {
    renderHome();
    const calls = mockedUseLiveApi.mock.calls;
    const attentionCall = calls.find((c) => String(c[0]).startsWith("api/attention"));
    expect(attentionCall).toBeDefined();
    expect(attentionCall?.[1]).toBeDefined();
    expect(typeof attentionCall?.[1]?.filter).toBe("function");

    // The other three have no options (or no filter).
    const others = calls.filter((c) => !String(c[0]).startsWith("api/attention"));
    for (const c of others) {
      expect(c[1]?.filter).toBeUndefined();
    }
  });
});

describe("Agents homepage — attention filter predicate", () => {
  function attentionFilter(): (e: EntryResponse) => boolean {
    renderHome();
    const attentionCall = mockedUseLiveApi.mock.calls.find((c) =>
      String(c[0]).startsWith("api/attention"),
    );
    if (!attentionCall) throw new Error("attention subscription missing");
    const fn = attentionCall[1]?.filter;
    if (!fn) throw new Error("attention filter missing");
    return fn;
  }

  it("admits pending entries", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "pending" }))).toBe(true);
  });

  it("admits block entries", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "block" }))).toBe(true);
  });

  it("admits timeout entries", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "timeout" }))).toBe(true);
  });

  it("admits high-risk allow entries (score >= 65)", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "allow", riskScore: 70 }))).toBe(true);
  });

  it("admits exactly at the high-risk threshold (score == 65)", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "allow", riskScore: 65 }))).toBe(true);
  });

  it("rejects low-risk allow entries (score < 65)", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "allow", riskScore: 30 }))).toBe(false);
  });

  it("rejects allow entries with no riskScore (treated as 0)", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "allow", riskScore: undefined }))).toBe(
      false,
    );
  });
});

// ── Stage C: IA reshuffle + 3-wide grid ───────────────────────────

describe("Agents homepage — Stage C IA order + anchors", () => {
  function renderWithEmpty() {
    mockedUseLiveApi.mockImplementation(() => defaultLiveApiReturn());
    return renderHome();
  }

  function domIndex(container: HTMLElement, selector: string): number {
    const el = container.querySelector(selector);
    if (!el) throw new Error(`selector not found: ${selector}`);
    return Array.from(container.querySelectorAll("*")).indexOf(el);
  }

  it("places the AgentsGrid section immediately after the AttentionInbox wrapper and before the FleetChart", () => {
    const { container } = renderWithEmpty();
    const inboxIdx = domIndex(container, "[data-cl-inbox-pending-anchor]");
    const agentsIdx = domIndex(container, "[data-cl-agents-anchor]");
    const chartIdx = domIndex(container, "[data-cl-fleet-chart-anchor]");
    expect(inboxIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(chartIdx);
  });

  it("renders every expected Stage C anchor exactly once", () => {
    const { container } = renderWithEmpty();
    const countOf = (sel: string) => container.querySelectorAll(sel).length;
    expect(countOf("[data-cl-fleet-chart-anchor]")).toBe(1);
    expect(countOf("[data-cl-agents-anchor]")).toBe(1);
    expect(countOf("#agents")).toBe(1);
    expect(countOf("[data-cl-inbox-pending-anchor]")).toBe(1);
    expect(countOf("[data-cl-inbox-blocked-anchor]")).toBe(1);
  });
});

describe("Agents homepage — Stage C 3-wide grid columns", () => {
  it("sets gridTemplateColumns to minmax(340px, 1fr) with gap 10 on the active-agents grid", () => {
    const alpha = {
      id: "alpha",
      name: "alpha",
      status: "active" as const,
      todayToolCalls: 3,
      avgRiskScore: 20,
      peakRiskScore: 30,
      lastActiveTimestamp: "2026-04-20T12:00:00Z",
      mode: "interactive" as const,
      riskPosture: "calm" as const,
      activityBreakdown: { exploring: 2, changes: 0, git: 0, scripts: 1, web: 0, comms: 0 },
      todayActivityBreakdown: {
        exploring: 2,
        changes: 0,
        git: 0,
        scripts: 1,
        web: 0,
        comms: 0,
      },
      needsAttention: false,
      blockedCount: 0,
      riskProfile: { low: 1, medium: 0, high: 0, critical: 0 },
      todayRiskMix: { low: 1, medium: 0, high: 0, critical: 0 },
      hourlyActivity: Array.from({ length: 24 }, () => 0),
    };

    // Route each subscription path to sensible data; agents must be non-empty so
    // the active grid renders.
    mockedUseLiveApi.mockImplementation((path: string) => {
      if (path.startsWith("api/agents")) {
        return { data: [alpha], loading: false, error: null, refetch: vi.fn() };
      }
      if (path.startsWith("api/stats")) {
        // isDormant returns true when total === 0 AND activeSessions === 0; use
        // non-zero values so the page renders the main surfaces instead of the
        // dormant panel.
        return {
          data: {
            total: 5,
            allowed: 5,
            approved: 0,
            blocked: 0,
            timedOut: 0,
            pending: 0,
            riskBreakdown: { low: 5, medium: 0, high: 0, critical: 0 },
            avgRiskScore: 10,
            peakRiskScore: 15,
            activeAgents: 1,
            activeSessions: 1,
            riskPosture: "calm",
            historicDailyMax: 5,
            yesterdayTotal: 3,
            weekAverage: 2,
            llmHealth: { recentAttempts: 0, recentFailures: 0, status: "ok" },
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return defaultLiveApiReturn();
    });

    const { container } = render(
      <MemoryRouter>
        <Agents />
      </MemoryRouter>,
    );

    const section = container.querySelector<HTMLElement>("[data-cl-agents-anchor]");
    expect(section).not.toBeNull();
    const grid = section?.querySelector<HTMLElement>("div.grid");
    expect(grid).not.toBeNull();
    // React serializes the camel-case style into the CSS `grid-template-columns`
    // property on the element's `style` object.
    expect(grid?.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(340px, 1fr))");
    expect(grid?.style.gap).toBe("10px");
  });
});

// ── agent-grid-polish §3 sort + §2(c) collision detection ─────────

const NON_DORMANT_STATS = {
  total: 5,
  allowed: 5,
  approved: 0,
  blocked: 0,
  timedOut: 0,
  pending: 0,
  riskBreakdown: { low: 5, medium: 0, high: 0, critical: 0 },
  avgRiskScore: 10,
  peakRiskScore: 15,
  activeAgents: 1,
  activeSessions: 1,
  riskPosture: "calm" as const,
  historicDailyMax: 5,
  yesterdayTotal: 3,
  weekAverage: 2,
  llmHealth: { recentAttempts: 0, recentFailures: 0, status: "ok" as const },
};

function makeAgentFixture(overrides: {
  id: string;
  tier?: "low" | "med" | "high" | "crit";
  lastActive?: string;
  calls?: number;
}): AgentInfo {
  // Map the requested tier to a todayRiskMix that lands on it via the
  // worstMeaningfulTier compound rule (any crit → CRIT; ≥2 high → HIGH; ≥5%
  // med → MED; else LOW). Sort branches read worstMeaningfulTier(mix), so
  // these mixes drive the ranking under test.
  const tier = overrides.tier ?? "low";
  const todayRiskMix: Record<RiskTier, number> =
    tier === "crit"
      ? { low: 100, medium: 0, high: 0, critical: 1 }
      : tier === "high"
        ? { low: 100, medium: 0, high: 2, critical: 0 }
        : tier === "med"
          ? { low: 95, medium: 5, high: 0, critical: 0 }
          : { low: 100, medium: 0, high: 0, critical: 0 };
  return {
    id: overrides.id,
    name: overrides.id,
    status: "active",
    todayToolCalls: overrides.calls ?? 10,
    avgRiskScore: 20,
    peakRiskScore: 30,
    lastActiveTimestamp: overrides.lastActive ?? "2026-04-20T12:00:00Z",
    mode: "interactive",
    riskPosture: "calm",
    activityBreakdown: { exploring: 1, changes: 0, git: 0, scripts: 0, web: 0, comms: 0 },
    todayActivityBreakdown: {
      exploring: 1,
      changes: 0,
      git: 0,
      scripts: 0,
      web: 0,
      comms: 0,
    },
    needsAttention: false,
    blockedCount: 0,
    riskProfile: { low: 1, medium: 0, high: 0, critical: 0 },
    todayRiskMix,
    hourlyActivity: Array.from({ length: 24 }, () => 0),
  };
}

function mockHomepage(agents: AgentInfo[]) {
  mockedUseLiveApi.mockImplementation((path: string) => {
    if (path.startsWith("api/agents")) {
      return { data: agents, loading: false, error: null, refetch: vi.fn() };
    }
    if (path.startsWith("api/stats")) {
      return { data: NON_DORMANT_STATS, loading: false, error: null, refetch: vi.fn() };
    }
    return defaultLiveApiReturn();
  });
}

function agentCardHrefs(container: HTMLElement): string[] {
  // Active agents grid is the first .grid inside [data-cl-agents-anchor].
  // Each AgentCardCompact renders a <Link> with href="/agent/<id>".
  const cards = container.querySelectorAll<HTMLAnchorElement>(
    "[data-cl-agents-anchor] a[href^='/agent/']",
  );
  return Array.from(cards).map((c) => c.getAttribute("href") ?? "");
}

function avatarLetterFor(container: HTMLElement, agentId: string): string | null {
  const card = container.querySelector<HTMLElement>(`a[href="/agent/${agentId}"]`);
  if (!card) return null;
  const outer = Array.from(card.querySelectorAll<HTMLElement>("div")).find((el) =>
    el.style.background?.includes("linear-gradient"),
  );
  return outer?.querySelector("span")?.textContent ?? null;
}

describe("Agents homepage — sort policy (agent-grid-polish §3)", () => {
  it("ranks higher-tier agent above lower-tier agent regardless of activity volume", () => {
    // Low-volume HIGH (5 calls) vs high-volume MED (100 calls). The pre-fix
    // sort (todayToolCalls desc) would put MED first; new sort (tier desc)
    // must put HIGH first because the tier pill is the strongest card signal.
    const lowVolHigh = makeAgentFixture({ id: "alpha", tier: "high", calls: 5 });
    const highVolMed = makeAgentFixture({ id: "beta", tier: "med", calls: 100 });
    mockHomepage([highVolMed, lowVolHigh]); // intentionally unsorted input
    const { container } = renderHome();
    expect(agentCardHrefs(container)).toEqual(["/agent/alpha", "/agent/beta"]);
  });

  it("orders critical > high > medium > low across all four tiers", () => {
    const low = makeAgentFixture({ id: "agent-low", tier: "low" });
    const med = makeAgentFixture({ id: "agent-med", tier: "med" });
    const hi = makeAgentFixture({ id: "agent-hi", tier: "high" });
    const crit = makeAgentFixture({ id: "agent-crit", tier: "crit" });
    mockHomepage([low, med, hi, crit]); // intentionally reversed input
    const { container } = renderHome();
    expect(agentCardHrefs(container)).toEqual([
      "/agent/agent-crit",
      "/agent/agent-hi",
      "/agent/agent-med",
      "/agent/agent-low",
    ]);
  });

  it("breaks ties within the same tier by lastActiveTimestamp desc (most recent first)", () => {
    const newer = makeAgentFixture({
      id: "newer",
      tier: "low",
      lastActive: "2026-04-20T15:00:00Z",
    });
    const older = makeAgentFixture({
      id: "older",
      tier: "low",
      lastActive: "2026-04-20T10:00:00Z",
    });
    mockHomepage([older, newer]);
    const { container } = renderHome();
    expect(agentCardHrefs(container)).toEqual(["/agent/newer", "/agent/older"]);
  });
});

describe("Agents homepage — avatar letter collision detection (agent-grid-polish §2(c))", () => {
  it("escalates colliding agents to 2-letter avatars when sharing first character", () => {
    // baddie + bestie share 'B' → both render BA / BE.
    // alpha doesn't collide → renders A.
    const baddie = makeAgentFixture({ id: "baddie" });
    const bestie = makeAgentFixture({ id: "bestie" });
    const alpha = makeAgentFixture({ id: "alpha" });
    mockHomepage([baddie, bestie, alpha]);
    const { container } = renderHome();
    expect(avatarLetterFor(container, "baddie")).toBe("BA");
    expect(avatarLetterFor(container, "bestie")).toBe("BE");
    expect(avatarLetterFor(container, "alpha")).toBe("A");
  });

  it("escalates 3+ agents sharing the first letter to 2-letter mode", () => {
    const baddie = makeAgentFixture({ id: "baddie" });
    const bestie = makeAgentFixture({ id: "bestie" });
    const biggie = makeAgentFixture({ id: "biggie" });
    mockHomepage([baddie, bestie, biggie]);
    const { container } = renderHome();
    expect(avatarLetterFor(container, "baddie")).toBe("BA");
    expect(avatarLetterFor(container, "bestie")).toBe("BE");
    expect(avatarLetterFor(container, "biggie")).toBe("BI");
  });

  it("non-colliding agents render single-letter avatars by default", () => {
    const alpha = makeAgentFixture({ id: "alpha" });
    const baddie = makeAgentFixture({ id: "baddie" });
    const charlie = makeAgentFixture({ id: "charlie" });
    mockHomepage([alpha, baddie, charlie]);
    const { container } = renderHome();
    expect(avatarLetterFor(container, "alpha")).toBe("A");
    expect(avatarLetterFor(container, "baddie")).toBe("B");
    expect(avatarLetterFor(container, "charlie")).toBe("C");
  });
});
