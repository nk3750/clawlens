import { describe, expect, it } from "vitest";
import { formatGatewayUptime, formatVersionLabel } from "../dashboard/src/lib/footerStatus";

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
