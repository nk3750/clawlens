import { describe, expect, it } from "vitest";
import {
  formatAuditAge,
  formatGatewayUptime,
  formatSSEStatusLabel,
  formatVersionLabel,
  sseStatusColorVar,
} from "../dashboard/src/lib/footerStatus";

describe("formatSSEStatusLabel", () => {
  it("labels live status", () => {
    expect(formatSSEStatusLabel("live")).toBe("SSE live");
  });
  it("labels reconnecting status", () => {
    expect(formatSSEStatusLabel("reconnecting")).toBe("SSE reconnecting");
  });
  it("labels offline status", () => {
    expect(formatSSEStatusLabel("offline")).toBe("SSE offline");
  });
});

describe("sseStatusColorVar", () => {
  it("maps live to the low-risk green token", () => {
    expect(sseStatusColorVar("live")).toBe("var(--cl-risk-low)");
  });
  it("maps reconnecting to the medium-risk amber token", () => {
    expect(sseStatusColorVar("reconnecting")).toBe("var(--cl-risk-medium)");
  });
  it("maps offline to the high-risk red token", () => {
    expect(sseStatusColorVar("offline")).toBe("var(--cl-risk-high)");
  });
});

describe("formatVersionLabel", () => {
  it("prefixes 'v' on a present version", () => {
    expect(formatVersionLabel("0.2.0")).toBe("ClawLens v0.2.0");
  });
  it("trims whitespace before deciding", () => {
    expect(formatVersionLabel("  1.4.2  ")).toBe("ClawLens v1.4.2");
  });
  it("falls back to bare 'ClawLens' when version is missing", () => {
    expect(formatVersionLabel(undefined)).toBe("ClawLens");
    expect(formatVersionLabel(null)).toBe("ClawLens");
    expect(formatVersionLabel("")).toBe("ClawLens");
    expect(formatVersionLabel("   ")).toBe("ClawLens");
  });
});

describe("formatAuditAge", () => {
  const NOW = Date.UTC(2026, 3, 17, 12, 0, 0);

  it("returns '—' when no timestamp provided", () => {
    expect(formatAuditAge(undefined, NOW)).toBe("audit —");
    expect(formatAuditAge(null, NOW)).toBe("audit —");
    expect(formatAuditAge("", NOW)).toBe("audit —");
  });

  it("returns '—' when timestamp is unparseable", () => {
    expect(formatAuditAge("not-a-date", NOW)).toBe("audit —");
  });

  it("shows seconds under 1 minute", () => {
    const iso = new Date(NOW - 14_000).toISOString();
    expect(formatAuditAge(iso, NOW)).toBe("audit 14s old");
  });

  it("shows minutes under 1 hour", () => {
    const iso = new Date(NOW - 5 * 60_000).toISOString();
    expect(formatAuditAge(iso, NOW)).toBe("audit 5m old");
  });

  it("shows hours under 1 day", () => {
    const iso = new Date(NOW - 3 * 3_600_000).toISOString();
    expect(formatAuditAge(iso, NOW)).toBe("audit 3h old");
  });

  it("shows days for older entries", () => {
    const iso = new Date(NOW - 2 * 86_400_000).toISOString();
    expect(formatAuditAge(iso, NOW)).toBe("audit 2d old");
  });

  it("clamps negative diffs to 0 (clock skew)", () => {
    const iso = new Date(NOW + 5_000).toISOString();
    expect(formatAuditAge(iso, NOW)).toBe("audit 0s old");
  });
});

describe("formatGatewayUptime", () => {
  it("returns '—' when uptime is unknown", () => {
    expect(formatGatewayUptime(undefined)).toBe("gateway —");
    expect(formatGatewayUptime(null)).toBe("gateway —");
  });

  it("rejects negative or non-finite values", () => {
    expect(formatGatewayUptime(-1)).toBe("gateway —");
    expect(formatGatewayUptime(Number.NaN)).toBe("gateway —");
    expect(formatGatewayUptime(Number.POSITIVE_INFINITY)).toBe("gateway —");
  });

  it("formats seconds / minutes / hours / days", () => {
    expect(formatGatewayUptime(30_000)).toBe("gateway 30s uptime");
    expect(formatGatewayUptime(5 * 60_000)).toBe("gateway 5m uptime");
    expect(formatGatewayUptime(6 * 3_600_000)).toBe("gateway 6h uptime");
    expect(formatGatewayUptime(3 * 86_400_000)).toBe("gateway 3d uptime");
  });
});
