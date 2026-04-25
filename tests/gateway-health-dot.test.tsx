// @vitest-environment jsdom

/**
 * Tests for `<GatewayHealthDot />` — the 8px nav-bar dot wired to
 * `useGatewayHealth`. Three colors / aria labels / `data-cl-gateway-health`
 * status attribute. Down state adds a glow.
 */

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../dashboard/src/hooks/useGatewayHealth", () => ({
  useGatewayHealth: vi.fn(),
}));

import GatewayHealthDot from "../dashboard/src/components/GatewayHealthDot";
import { useGatewayHealth } from "../dashboard/src/hooks/useGatewayHealth";

const mockedUseGatewayHealth = vi.mocked(useGatewayHealth);

afterEach(() => {
  vi.clearAllMocks();
});

describe("GatewayHealthDot", () => {
  it("renders a grey dot with 'unknown' aria when status is unknown", () => {
    mockedUseGatewayHealth.mockReturnValue("unknown");
    const { container } = render(<GatewayHealthDot />);
    const dot = container.querySelector<HTMLElement>("[data-cl-gateway-health]");
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("data-cl-gateway-health")).toBe("unknown");
    // Grey muted-text token. Testing the inline style preserves the design
    // token without locking us into a specific resolved color.
    expect(dot?.style.background).toBe("var(--cl-text-muted)");
    // Aria label + title both present (sighted + assistive parity).
    expect(dot?.getAttribute("aria-label")).toBeTruthy();
    expect(dot?.getAttribute("title")).toBeTruthy();
    // Down-state glow MUST NOT be applied for "unknown".
    expect(dot?.style.boxShadow || "").toBe("");
  });

  it("renders a green dot with 'connected' aria when status is ok", () => {
    mockedUseGatewayHealth.mockReturnValue("ok");
    const { container } = render(<GatewayHealthDot />);
    const dot = container.querySelector<HTMLElement>("[data-cl-gateway-health]");
    expect(dot?.getAttribute("data-cl-gateway-health")).toBe("ok");
    expect(dot?.style.background).toBe("var(--cl-risk-low)");
    expect(dot?.getAttribute("aria-label")).toMatch(/connected|ok|healthy/i);
    expect(dot?.getAttribute("title")).toMatch(/connected|ok|healthy/i);
    // No glow on the OK path — visual quiet for the steady state.
    expect(dot?.style.boxShadow || "").toBe("");
  });

  it("renders a red dot with glow + 'unreachable' aria when status is down", () => {
    mockedUseGatewayHealth.mockReturnValue("down");
    const { container } = render(<GatewayHealthDot />);
    const dot = container.querySelector<HTMLElement>("[data-cl-gateway-health]");
    expect(dot?.getAttribute("data-cl-gateway-health")).toBe("down");
    expect(dot?.style.background).toBe("var(--cl-risk-high)");
    expect(dot?.getAttribute("aria-label")).toMatch(/unreachable|offline|down/i);
    expect(dot?.getAttribute("title")).toMatch(/unreachable|offline|down/i);
    // Glow uses the same risk-high token.
    expect(dot?.style.boxShadow).toContain("var(--cl-risk-high)");
  });

  it.each([
    "unknown",
    "ok",
    "down",
  ] as const)("data-cl-gateway-health attribute echoes the hook status (%s)", (status) => {
    mockedUseGatewayHealth.mockReturnValue(status);
    const { container } = render(<GatewayHealthDot />);
    expect(
      container.querySelector("[data-cl-gateway-health]")?.getAttribute("data-cl-gateway-health"),
    ).toBe(status);
  });
});
