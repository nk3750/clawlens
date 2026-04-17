import { describe, expect, it } from "vitest";
import { deriveScheduleLabel } from "../src/dashboard/cadence";

describe("deriveScheduleLabel", () => {
  it("returns the 8-hour interval from three evenly spaced starts", () => {
    const starts = ["2026-04-16T23:05:00Z", "2026-04-16T15:05:00Z", "2026-04-16T07:05:00Z"];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 8h");
  });

  it("returns 'daily' when interval is approximately 24h", () => {
    const starts = ["2026-04-16T09:00:00Z", "2026-04-15T09:00:00Z", "2026-04-14T09:00:00Z"];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("daily");
  });

  it("returns 'every Nm' for minute-level cadence", () => {
    const starts = [
      "2026-04-16T12:15:00Z",
      "2026-04-16T12:10:00Z",
      "2026-04-16T12:05:00Z",
      "2026-04-16T12:00:00Z",
    ];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 5m");
  });

  it("returns 'every Nd' for multi-day cadence", () => {
    const starts = ["2026-04-16T12:00:00Z", "2026-04-13T12:00:00Z", "2026-04-10T12:00:00Z"];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 3d");
  });

  it("returns null for interactive mode", () => {
    const starts = ["2026-04-16T12:15:00Z", "2026-04-16T12:10:00Z"];
    expect(deriveScheduleLabel("interactive", starts)).toBeNull();
  });

  it("returns null with fewer than 2 starts", () => {
    expect(deriveScheduleLabel("scheduled", [])).toBeNull();
    expect(deriveScheduleLabel("scheduled", ["2026-04-16T12:00:00Z"])).toBeNull();
  });

  it("prefers an explicit schedule over inference", () => {
    expect(deriveScheduleLabel("scheduled", [], "every 30m")).toBe("every 30m");
    // even in interactive mode, explicit wins
    expect(deriveScheduleLabel("interactive", [], "manual")).toBe("manual");
  });

  it("handles unsorted input (order-agnostic)", () => {
    const starts = ["2026-04-16T07:05:00Z", "2026-04-16T23:05:00Z", "2026-04-16T15:05:00Z"];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 8h");
  });

  it("uses the median when intervals vary slightly", () => {
    // 8h, 8h, 7h59m — median should still round to 8h
    const starts = [
      "2026-04-17T00:00:00Z",
      "2026-04-16T16:00:00Z",
      "2026-04-16T08:00:00Z",
      "2026-04-16T00:01:00Z",
    ];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 8h");
  });
});
