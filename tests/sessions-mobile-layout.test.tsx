// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => [],
}));
vi.stubGlobal("fetch", fetchMock);

// Mirror tests/activity-mobile-layout.test.tsx — minimal matchMedia stub that
// computes match against a simulated viewport width per (max-width: NNNNpx).
type MqlListener = (e: MediaQueryListEvent) => void;
interface FakeMql {
  matches: boolean;
  media: string;
  onchange: MqlListener | null;
  addEventListener: (type: "change", cb: MqlListener) => void;
  removeEventListener: (type: "change", cb: MqlListener) => void;
  dispatchEvent: (matches: boolean) => void;
}

const queryListenerCache = new Map<string, FakeMql>();

function matchesQuery(query: string, width: number): boolean {
  const m = query.match(/\(\s*max-width:\s*(\d+)px\s*\)/);
  if (m) return width <= Number.parseInt(m[1], 10);
  return false;
}

function installViewport(width: number): void {
  queryListenerCache.clear();
  const factory = vi.fn().mockImplementation((query: string): FakeMql => {
    const cached = queryListenerCache.get(query);
    if (cached) return cached;
    const listeners = new Set<MqlListener>();
    const mql: FakeMql = {
      matches: matchesQuery(query, width),
      media: query,
      onchange: null,
      addEventListener: (type, cb) => {
        if (type === "change") listeners.add(cb);
      },
      removeEventListener: (type, cb) => {
        if (type === "change") listeners.delete(cb);
      },
      dispatchEvent: (matches: boolean) => {
        mql.matches = matches;
        for (const l of listeners) l({ matches } as MediaQueryListEvent);
      },
    };
    queryListenerCache.set(query, mql);
    return mql;
  });
  vi.stubGlobal("matchMedia", factory);
  // biome-ignore lint/suspicious/noExplicitAny: stub a Web API on the test window
  (window as any).matchMedia = factory;
}

/** Move the simulated viewport without remounting — fires change events. */
function resizeViewport(width: number): void {
  for (const [query, mql] of queryListenerCache) {
    mql.dispatchEvent(matchesQuery(query, width));
  }
}

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
  // biome-ignore lint/suspicious/noExplicitAny: minimal AgentInfo for the rail
} as any;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url !== "string") return jsonResp([]);
    if (url.includes("/api/agents")) return jsonResp([ALPHA]);
    if (url.includes("/api/sessions")) {
      return jsonResp({ sessions: [session()], total: 1 });
    }
    return jsonResp([]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", fetchMock);
  document.body.style.overflow = "";
  queryListenerCache.clear();
});

function mountSessions() {
  return render(
    <MemoryRouter initialEntries={["/sessions"]}>
      <Routes>
        <Route path="/sessions" element={<Sessions />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Sessions — desktop layout (>1024px)", () => {
  it("renders the desktop sidebar and no hamburger", async () => {
    installViewport(1280);
    mountSessions();
    await waitFor(() => expect(screen.getByTestId("filter-rail")).toBeInTheDocument());
    expect(screen.queryByTestId("sessions-drawer-toggle")).toBeNull();
    expect(screen.getByTestId("sessions-grid").style.gridTemplateColumns).toBe("244px 1fr");
  });
});

describe("Sessions — drawer mode at ≤1024px", () => {
  it("hides the desktop sidebar and shows the hamburger toggle", async () => {
    installViewport(1023);
    mountSessions();
    await waitFor(() => expect(screen.getByTestId("sessions-drawer-toggle")).toBeInTheDocument());
    expect(screen.queryByTestId("filter-rail")).toBeNull();
    expect(screen.getByTestId("sessions-grid").style.gridTemplateColumns).toBe("1fr");
  });

  it("clicking the hamburger opens the drawer with the filter rail inside", async () => {
    installViewport(1023);
    mountSessions();
    await waitFor(() => expect(screen.getByTestId("sessions-drawer-toggle")).toBeInTheDocument());

    expect(screen.queryByTestId("sessions-drawer")).toBeNull();
    fireEvent.click(screen.getByTestId("sessions-drawer-toggle"));
    const drawer = await screen.findByTestId("sessions-drawer");
    expect(within(drawer).getByTestId("filter-rail")).toBeInTheDocument();
  });

  it("ESC closes the drawer when open", async () => {
    installViewport(1023);
    mountSessions();
    fireEvent.click(await screen.findByTestId("sessions-drawer-toggle"));
    await screen.findByTestId("sessions-drawer");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("sessions-drawer")).toBeNull());
  });

  it("clicking the backdrop closes the drawer", async () => {
    installViewport(1023);
    mountSessions();
    fireEvent.click(await screen.findByTestId("sessions-drawer-toggle"));
    await screen.findByTestId("sessions-drawer");

    fireEvent.click(screen.getByTestId("sessions-drawer-backdrop"));
    await waitFor(() => expect(screen.queryByTestId("sessions-drawer")).toBeNull());
  });

  it("selecting a filter inside the drawer closes the drawer", async () => {
    installViewport(1023);
    mountSessions();
    fireEvent.click(await screen.findByTestId("sessions-drawer-toggle"));
    const drawer = await screen.findByTestId("sessions-drawer");

    const agentRow = within(drawer).getByTestId("filter-row-agent-alpha");
    fireEvent.click(agentRow);

    await waitFor(() => expect(screen.queryByTestId("sessions-drawer")).toBeNull());
  });

  it("resizing past 1024px while the drawer is open closes it", async () => {
    installViewport(1023);
    mountSessions();
    fireEvent.click(await screen.findByTestId("sessions-drawer-toggle"));
    await screen.findByTestId("sessions-drawer");

    resizeViewport(1280);

    await waitFor(() => expect(screen.queryByTestId("sessions-drawer")).toBeNull());
  });
});
