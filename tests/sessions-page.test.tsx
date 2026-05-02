// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import type { ActivityCategory, AgentInfo, SessionInfo } from "../dashboard/src/lib/types";
import Sessions from "../dashboard/src/pages/Sessions";

function jsonResp(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const breakdown: Record<ActivityCategory, number> = {
    exploring: 0,
    changes: 0,
    git: 0,
    scripts: 0,
    web: 0,
    comms: 0,
    orchestration: 0,
    media: 0,
  };
  return {
    sessionKey: "alpha:terminal:1",
    agentId: "alpha",
    startTime: "2026-04-26T17:00:00.000Z",
    endTime: "2026-04-26T17:05:00.000Z",
    duration: 5 * 60_000,
    toolCallCount: 3,
    avgRisk: 30,
    peakRisk: 50,
    activityBreakdown: breakdown,
    blockedCount: 0,
    context: "terminal",
    toolSummary: [],
    riskSparkline: [10, 30, 50],
    ...overrides,
  };
}

const ALPHA: AgentInfo = {
  id: "alpha",
  name: "alpha",
  status: "active",
  lastSeen: "2026-04-26T17:55:00.000Z",
  totalDecisions: 12,
  blockedDecisions: 0,
  riskScore: 30,
  // biome-ignore lint/suspicious/noExplicitAny: minimal AgentInfo for the rail counts
} as any;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/agents")) return jsonResp([ALPHA]);
    if (url.includes("/api/sessions")) {
      return jsonResp({ sessions: [], total: 0 });
    }
    return jsonResp([]);
  });
});

afterEach(() => {
  fetchMock.mockReset();
});

function LocationProbe() {
  const loc = useLocation();
  return (
    <span data-testid="location">
      {loc.pathname}
      {loc.search}
    </span>
  );
}

function mountSessionsAt(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <LocationProbe />
      <Routes>
        <Route path="/sessions" element={<Sessions />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Sessions — initial render & URL defaults", () => {
  it("seeds since=24h in the URL on first mount when no since param exists", async () => {
    mountSessionsAt("/sessions");
    await waitFor(() => {
      const loc = screen.getByTestId("location").textContent ?? "";
      expect(loc).toContain("since=24h");
    });
  });

  it("includes the active filters from the URL in the chip strip", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/agents")) return jsonResp([ALPHA]);
      if (url.includes("/api/sessions")) {
        return jsonResp({ sessions: [session()], total: 1 });
      }
      return jsonResp([]);
    });
    mountSessionsAt("/sessions?agent=alpha&risk=high");
    await waitFor(() => {
      expect(screen.getByTestId("active-chip-agent").textContent).toMatch(/alpha/);
      expect(screen.getByTestId("active-chip-risk").textContent).toMatch(/high/i);
    });
  });

  it("renders one row per session returned by the API", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/agents")) return jsonResp([ALPHA]);
      if (url.includes("/api/sessions")) {
        return jsonResp({
          sessions: [session({ sessionKey: "alpha:t:1" }), session({ sessionKey: "alpha:t:2" })],
          total: 2,
        });
      }
      return jsonResp([]);
    });
    mountSessionsAt("/sessions");
    await waitFor(() => {
      expect(screen.getAllByTestId("session-row-link")).toHaveLength(2);
    });
  });

  it("shows the empty state when no sessions match", async () => {
    mountSessionsAt("/sessions");
    await waitFor(() => {
      expect(screen.getByTestId("sessions-empty")).toBeInTheDocument();
    });
  });
});

describe("Sessions — active filter chip removal", () => {
  it("clicking the chip × removes the filter and updates the URL", async () => {
    mountSessionsAt("/sessions?agent=alpha&risk=high&since=24h");
    await waitFor(() => expect(screen.getByTestId("active-chip-agent")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("active-chip-agent-remove"));

    await waitFor(() => {
      const loc = screen.getByTestId("location").textContent ?? "";
      expect(loc).not.toContain("agent=");
      expect(loc).toContain("risk=high");
    });
  });

  it("CLEAR ALL drops every filter from the URL", async () => {
    mountSessionsAt("/sessions?agent=alpha&risk=high&since=24h");
    await waitFor(() => expect(screen.getByTestId("active-filter-clear-all")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("active-filter-clear-all"));

    await waitFor(() => {
      const loc = screen.getByTestId("location").textContent ?? "";
      // CLEAR ALL drops everything explicitly — not even the default
      // since=24h is re-applied (per /activity convention; URL is the truth).
      expect(loc).not.toContain("agent=");
      expect(loc).not.toContain("risk=");
    });
  });
});

describe("Sessions — preset bar", () => {
  it("clicking the high-risk-only preset replaces filters with risk=high", async () => {
    mountSessionsAt("/sessions");
    const preset = await screen.findByTestId("preset-high-risk-only");
    fireEvent.click(preset);

    await waitFor(() => {
      const loc = screen.getByTestId("location").textContent ?? "";
      expect(loc).toContain("risk=high");
    });
  });

  it("live-now preset is a frontend narrowing — narrows the displayed list to active sessions", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/agents")) return jsonResp([ALPHA]);
      if (url.includes("/api/sessions")) {
        return jsonResp({
          sessions: [
            session({ sessionKey: "alpha:t:live", endTime: null, duration: null }),
            session({ sessionKey: "alpha:t:closed" }),
          ],
          total: 2,
        });
      }
      return jsonResp([]);
    });
    mountSessionsAt("/sessions?view=live");
    await waitFor(() => {
      expect(screen.getAllByTestId("session-row-link")).toHaveLength(1);
    });
  });
});

describe("Sessions — Load more pagination", () => {
  it("renders Load more when sessions returned < total", async () => {
    const sessions = Array.from({ length: 25 }, (_, i) => session({ sessionKey: `alpha:t:${i}` }));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/agents")) return jsonResp([ALPHA]);
      if (url.includes("/api/sessions")) {
        const offset = Number(new URL(url, "http://x").searchParams.get("offset") ?? 0);
        if (offset === 0) return jsonResp({ sessions, total: 30 });
        return jsonResp({
          sessions: Array.from({ length: 5 }, (_, i) =>
            session({ sessionKey: `alpha:t:${25 + i}` }),
          ),
          total: 30,
        });
      }
      return jsonResp([]);
    });
    mountSessionsAt("/sessions");
    await waitFor(() => expect(screen.getByTestId("sessions-load-more")).toBeInTheDocument());
    expect(screen.getAllByTestId("session-row-link")).toHaveLength(25);

    fireEvent.click(screen.getByTestId("sessions-load-more"));

    await waitFor(() => {
      expect(screen.getAllByTestId("session-row-link")).toHaveLength(30);
    });
  });
});

describe("Sessions — filter rail", () => {
  it("does NOT render a free-text search input (§11.5)", async () => {
    mountSessionsAt("/sessions");
    await waitFor(() => expect(screen.getByTestId("filter-rail")).toBeInTheDocument());
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
  });

  it("does NOT render a saved-searches group (§11.6)", async () => {
    mountSessionsAt("/sessions");
    await waitFor(() => expect(screen.getByTestId("filter-rail")).toBeInTheDocument());
    expect(screen.queryByTestId(/saved-search/i)).toBeNull();
  });

  it("clicking an agent option adds agent= to the URL", async () => {
    mountSessionsAt("/sessions");
    const agentRow = await screen.findByTestId("filter-row-agent-alpha");
    fireEvent.click(agentRow);

    await waitFor(() => {
      const loc = screen.getByTestId("location").textContent ?? "";
      expect(loc).toContain("agent=alpha");
    });
  });

  it("clicking a duration option uses URL key duration with lt1m / 1to10m / gt10m (§11.3)", async () => {
    mountSessionsAt("/sessions");
    const row = await screen.findByTestId("filter-row-duration-1to10m");
    fireEvent.click(row);

    await waitFor(() => {
      const loc = screen.getByTestId("location").textContent ?? "";
      expect(loc).toContain("duration=1to10m");
    });
  });
});
