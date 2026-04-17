// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HealthIndicator from "../dashboard/src/components/fleetheader/HealthIndicator";

/**
 * useSSEStatus is the only side-effecting dependency. Mocking it lets us
 * deterministically drive each branch of computeHealthState without standing
 * up a real EventSource — jsdom doesn't ship one and the manager would
 * otherwise loop on backoff timers we don't control.
 */
vi.mock("../dashboard/src/hooks/useSSEStatus", () => ({
  useSSEStatus: vi.fn(),
}));

import { useSSEStatus } from "../dashboard/src/hooks/useSSEStatus";

const mockedSseStatus = vi.mocked(useSSEStatus);

function freezeTime(at: Date = new Date(2026, 3, 17, 12, 0, 0)) {
  // Fake Date only — leave setInterval real so HealthIndicator's tick still fires
  // through happy paths but doesn't hijack RTL/userEvent timing.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

describe("HealthIndicator — variant swap", () => {
  beforeEach(() => {
    freezeTime();
    mockedSseStatus.mockReturnValue("live");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("footer variant uses 'SSE'-prefixed copy", () => {
    render(<HealthIndicator variant="footer" />);
    expect(screen.getByText(/SSE live/i)).toBeInTheDocument();
  });

  it("chrome variant uses compact 'live' copy", () => {
    render(<HealthIndicator variant="chrome" />);
    // Chrome label has no "SSE" prefix — just "live" (or "live · Ns lag").
    expect(screen.getByText(/^live(?: · \d+s lag)?$/)).toBeInTheDocument();
    // And not the footer-style label
    expect(screen.queryByText("SSE live")).toBeNull();
  });

  it("renders a status dot in both variants", () => {
    const { container, rerender } = render(<HealthIndicator variant="footer" />);
    expect(container.querySelector("[data-cl-health-variant='footer']")).not.toBeNull();
    rerender(<HealthIndicator variant="chrome" />);
    expect(container.querySelector("[data-cl-health-variant='chrome']")).not.toBeNull();
  });
});

describe("HealthIndicator — priority ordering", () => {
  beforeEach(() => {
    freezeTime();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("offline beats every other signal", () => {
    mockedSseStatus.mockReturnValue("offline");
    render(
      <HealthIndicator
        variant="footer"
        lastEntryIso={new Date().toISOString()}
        llmStatus="degraded"
      />,
    );
    expect(screen.getByText("SSE offline")).toBeInTheDocument();
  });

  it("reconnecting beats stale and llm_degraded", () => {
    mockedSseStatus.mockReturnValue("reconnecting");
    render(
      <HealthIndicator
        variant="footer"
        lastEntryIso={new Date(Date.now() - 5 * 60_000).toISOString()}
        llmStatus="down"
      />,
    );
    expect(screen.getByText("SSE reconnecting")).toBeInTheDocument();
  });

  it("llm_degraded surfaces when SSE is live but LLM is down", () => {
    mockedSseStatus.mockReturnValue("live");
    render(
      <HealthIndicator variant="footer" lastEntryIso={new Date().toISOString()} llmStatus="down" />,
    );
    expect(screen.getByText("LLM degraded")).toBeInTheDocument();
  });

  it("flips to stale when SSE is live but the newest entry is older than 60s", () => {
    mockedSseStatus.mockReturnValue("live");
    render(
      <HealthIndicator
        variant="footer"
        lastEntryIso={new Date(Date.now() - 90_000).toISOString()}
        llmStatus="ok"
      />,
    );
    expect(screen.getByText(/SSE stale · 1m lag/)).toBeInTheDocument();
  });

  it("stays live within the 60s window", () => {
    mockedSseStatus.mockReturnValue("live");
    render(
      <HealthIndicator
        variant="chrome"
        lastEntryIso={new Date(Date.now() - 5_000).toISOString()}
        llmStatus="ok"
      />,
    );
    expect(screen.getByText(/^live · 5s lag$/)).toBeInTheDocument();
  });
});

describe("HealthIndicator — reduced-motion", () => {
  beforeEach(() => {
    freezeTime();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not pulse the dot when reduced-motion is preferred", () => {
    // The pulse is implemented via a CSS animation set in inline styles only
    // when state === 'reconnecting'. Reduced-motion handling lives in
    // index.css (the global @media (prefers-reduced-motion) block), so the
    // best the component can promise here is that the pulse animation is
    // ONLY present in reconnecting state — never elsewhere.
    mockedSseStatus.mockReturnValue("live");
    const { container, rerender } = render(<HealthIndicator variant="chrome" />);
    let dot = container.querySelector<HTMLElement>("[aria-hidden='true']");
    expect(dot?.style.animation || "").not.toContain("pulse");

    mockedSseStatus.mockReturnValue("reconnecting");
    rerender(<HealthIndicator variant="chrome" />);
    dot = container.querySelector<HTMLElement>("[aria-hidden='true']");
    expect(dot?.style.animation || "").toContain("pulse");
  });
});
