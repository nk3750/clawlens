import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeHealthState,
  computeTrend,
  formatDateChipLabel,
  formatHealthChromeLabel,
  formatHealthFooterLabel,
  formatLagShort,
  healthDotColor,
  isDateSelectable,
  isRangeOption,
  lagSeconds,
  parseRetentionDays,
  postureDotColor,
  postureLabel,
  postureTooltip,
  quickDateOptions,
  quickRangeSpans,
  RANGE_OPTIONS,
  shiftDay,
  shouldShowBlockedChip,
  shouldShowPendingChip,
  splitAgentsRunning,
  todayLocalISO,
} from "../dashboard/src/components/fleetheader/utils";

// ── computeTrend ─────────────────────────────────────────────

describe("computeTrend", () => {
  it("returns empty when both today and yesterday are zero", () => {
    expect(computeTrend(0, 0)).toEqual({ kind: "empty" });
  });

  it("returns 'new' when yesterday was zero but today has data", () => {
    const t = computeTrend(42, 0);
    expect(t.kind).toBe("new");
    expect(t.label).toBe("first day tracking");
    expect(t.pct).toBeUndefined();
  });

  it("returns 'same' when today equals yesterday", () => {
    const t = computeTrend(99, 99);
    expect(t.kind).toBe("same");
    expect(t.label).toBe("— same as yesterday");
  });

  it("returns 'up' with rounded percent", () => {
    const t = computeTrend(192, 97);
    expect(t.kind).toBe("up");
    expect(t.pct).toBe(98); // (192-97)/97 = 0.9794 → 98%
    expect(t.label).toBe("↑ 98% vs yesterday");
  });

  it("returns 'down' with rounded percent", () => {
    const t = computeTrend(60, 100);
    expect(t.kind).toBe("down");
    expect(t.pct).toBe(40);
    expect(t.label).toBe("↓ 40% vs yesterday");
  });

  it("rounds half-up like the spec example", () => {
    expect(computeTrend(10, 9).pct).toBe(11); // 11.11% → 11
  });
});

// ── isRangeOption / RANGE_OPTIONS ────────────────────────────

describe("RANGE_OPTIONS / isRangeOption", () => {
  it("includes the six pills the header advertises", () => {
    expect(RANGE_OPTIONS).toEqual(["24h", "12h", "6h", "3h", "1h", "7d"]);
  });

  it("guards against arbitrary strings", () => {
    expect(isRangeOption("12h")).toBe(true);
    expect(isRangeOption("7d")).toBe(true);
    expect(isRangeOption("48h")).toBe(false);
    expect(isRangeOption("")).toBe(false);
    expect(isRangeOption(null)).toBe(false);
    expect(isRangeOption(undefined)).toBe(false);
    expect(isRangeOption(12)).toBe(false);
  });
});

// ── formatDateChipLabel ──────────────────────────────────────

describe("formatDateChipLabel", () => {
  it("returns TODAY when viewing matches today", () => {
    expect(formatDateChipLabel("2026-04-17", "2026-04-17")).toBe("TODAY");
  });

  it("returns weekday + month + day for past dates (uppercased)", () => {
    // 2026-04-13 is a Monday
    expect(formatDateChipLabel("2026-04-13", "2026-04-17")).toBe("MON, APR 13");
  });
});

// ── shiftDay / todayLocalISO ─────────────────────────────────

describe("shiftDay", () => {
  it("walks forward and backward by N days", () => {
    expect(shiftDay("2026-04-17", -1)).toBe("2026-04-16");
    expect(shiftDay("2026-04-17", 1)).toBe("2026-04-18");
    expect(shiftDay("2026-04-17", -7)).toBe("2026-04-10");
  });

  it("handles month boundaries", () => {
    expect(shiftDay("2026-04-01", -1)).toBe("2026-03-31");
    expect(shiftDay("2026-03-31", 1)).toBe("2026-04-01");
  });
});

describe("todayLocalISO", () => {
  it("formats the local date as YYYY-MM-DD", () => {
    const d = new Date(2026, 3, 17, 9, 30); // local time
    expect(todayLocalISO(d)).toBe("2026-04-17");
  });
});

// ── parseRetentionDays / isDateSelectable / quickDateOptions ──

describe("parseRetentionDays", () => {
  it("parses canonical Nd strings", () => {
    expect(parseRetentionDays("30d")).toBe(30);
    expect(parseRetentionDays("7d")).toBe(7);
    expect(parseRetentionDays("90d")).toBe(90);
  });

  it("trims whitespace and is case-insensitive", () => {
    expect(parseRetentionDays("  14D ")).toBe(14);
  });

  it("falls back to 30 when missing or malformed", () => {
    expect(parseRetentionDays(undefined)).toBe(30);
    expect(parseRetentionDays(null)).toBe(30);
    expect(parseRetentionDays("")).toBe(30);
    expect(parseRetentionDays("forever")).toBe(30);
    expect(parseRetentionDays("0d")).toBe(30);
    expect(parseRetentionDays("-5d")).toBe(30);
  });
});

describe("isDateSelectable", () => {
  it("rejects future dates", () => {
    expect(isDateSelectable("2026-04-18", "2026-04-17", 30)).toBe(false);
  });

  it("accepts today", () => {
    expect(isDateSelectable("2026-04-17", "2026-04-17", 30)).toBe(true);
  });

  it("accepts the earliest date inside retention", () => {
    expect(isDateSelectable("2026-03-18", "2026-04-17", 30)).toBe(true);
  });

  it("rejects dates older than retention", () => {
    expect(isDateSelectable("2026-03-17", "2026-04-17", 30)).toBe(false);
  });
});

describe("quickDateOptions", () => {
  it("emits 7 entries: Today, Yesterday, then weekday labels", () => {
    const opts = quickDateOptions("2026-04-17", 30);
    expect(opts).toHaveLength(7);
    expect(opts[0].label).toBe("Today");
    expect(opts[0].iso).toBe("2026-04-17");
    expect(opts[1].label).toBe("Yesterday");
    expect(opts[1].iso).toBe("2026-04-16");
    // 2026-04-15 = Wednesday
    expect(opts[2].label).toBe("Wed");
    expect(opts[2].iso).toBe("2026-04-15");
  });

  it("disables entries past the retention boundary", () => {
    // retention 3 → only Today, Yesterday, T-2, T-3 selectable
    const opts = quickDateOptions("2026-04-17", 3);
    expect(opts[0].disabled).toBe(false);
    expect(opts[3].disabled).toBe(false);
    expect(opts[4].disabled).toBe(true);
    expect(opts[5].disabled).toBe(true);
    expect(opts[6].disabled).toBe(true);
  });
});

describe("quickRangeSpans", () => {
  it("emits Last 7 days with range='7d' and no date shift", () => {
    const spans = quickRangeSpans();
    expect(spans[0]).toEqual({ label: "Last 7 days", range: "7d", dateOffset: 0 });
  });

  it("emits Last 30 days without a range change, shifting date back 30 days", () => {
    const spans = quickRangeSpans();
    expect(spans[1]).toEqual({ label: "Last 30 days", range: null, dateOffset: -30 });
  });

  it("returns a stable shape callers can trust", () => {
    const spans = quickRangeSpans();
    expect(spans).toHaveLength(2);
    for (const s of spans) {
      expect(typeof s.label).toBe("string");
      expect(typeof s.dateOffset).toBe("number");
      expect(s.range === null || typeof s.range === "string").toBe(true);
    }
  });
});

// ── shouldShowBlockedChip / shouldShowPendingChip ────────────

describe("chip visibility", () => {
  it("shouldShowBlockedChip is true only when count > 0", () => {
    expect(shouldShowBlockedChip(1)).toBe(true);
    expect(shouldShowBlockedChip(99)).toBe(true);
    expect(shouldShowBlockedChip(0)).toBe(false);
    expect(shouldShowBlockedChip(-1)).toBe(false);
    expect(shouldShowBlockedChip(undefined)).toBe(false);
    expect(shouldShowBlockedChip(null)).toBe(false);
  });

  it("shouldShowPendingChip mirrors the same predicate", () => {
    expect(shouldShowPendingChip(2)).toBe(true);
    expect(shouldShowPendingChip(0)).toBe(false);
    expect(shouldShowPendingChip(undefined)).toBe(false);
  });
});

// ── splitAgentsRunning ───────────────────────────────────────

describe("splitAgentsRunning", () => {
  it("treats activeSessions as the running count, remainder as between", () => {
    expect(splitAgentsRunning(6, 4)).toEqual({ runningNow: 4, betweenSessions: 2 });
  });

  it("clamps when activeSessions exceeds activeAgents", () => {
    // Race condition: the SSE refresh can put sessions ahead of agents.
    expect(splitAgentsRunning(2, 5)).toEqual({ runningNow: 2, betweenSessions: 0 });
  });

  it("never returns negative numbers", () => {
    expect(splitAgentsRunning(0, 0)).toEqual({ runningNow: 0, betweenSessions: 0 });
    expect(splitAgentsRunning(0, 3)).toEqual({ runningNow: 0, betweenSessions: 0 });
  });
});

// ── posture helpers ──────────────────────────────────────────

describe("posture helpers", () => {
  it("postureLabel uppercases each posture", () => {
    expect(postureLabel("calm")).toBe("CALM");
    expect(postureLabel("elevated")).toBe("ELEVATED");
    expect(postureLabel("high")).toBe("HIGH");
    expect(postureLabel("critical")).toBe("CRITICAL");
  });

  it("postureDotColor maps to the tier palette", () => {
    expect(postureDotColor("calm")).toBe("var(--cl-risk-low)");
    expect(postureDotColor("elevated")).toBe("var(--cl-risk-medium)");
    expect(postureDotColor("high")).toBe("var(--cl-risk-high)");
    expect(postureDotColor("critical")).toBe("var(--cl-risk-critical)");
  });

  it("postureTooltip provides distinct copy per posture", () => {
    expect(postureTooltip("calm")).toContain("0 high-risk");
    expect(postureTooltip("elevated")).toContain("1–2");
    expect(postureTooltip("high")).toContain("3+");
    expect(postureTooltip("critical")).toContain("Blocked");
  });
});

// ── lagSeconds / formatLagShort ──────────────────────────────

describe("lagSeconds", () => {
  const NOW = Date.UTC(2026, 3, 17, 12, 0, 0);

  it("returns null when input is missing or unparseable", () => {
    expect(lagSeconds(undefined, NOW)).toBeNull();
    expect(lagSeconds(null, NOW)).toBeNull();
    expect(lagSeconds("", NOW)).toBeNull();
    expect(lagSeconds("not-a-date", NOW)).toBeNull();
  });

  it("returns floored seconds since lastEntry", () => {
    const iso = new Date(NOW - 12_000).toISOString();
    expect(lagSeconds(iso, NOW)).toBe(12);
  });

  it("clamps negative lag to zero (clock skew)", () => {
    const iso = new Date(NOW + 5_000).toISOString();
    expect(lagSeconds(iso, NOW)).toBe(0);
  });
});

describe("formatLagShort", () => {
  it("uses seconds under 1 minute", () => {
    expect(formatLagShort(0)).toBe("0s");
    expect(formatLagShort(45)).toBe("45s");
  });

  it("uses minutes under 1 hour", () => {
    expect(formatLagShort(120)).toBe("2m");
  });

  it("uses hours under 1 day", () => {
    expect(formatLagShort(3600)).toBe("1h");
  });

  it("uses days for older lags", () => {
    expect(formatLagShort(2 * 86400)).toBe("2d");
  });
});

// ── computeHealthState + label formatters ────────────────────

describe("computeHealthState", () => {
  const NOW = Date.UTC(2026, 3, 17, 12, 0, 0);

  it("offline beats every other signal", () => {
    expect(
      computeHealthState({
        sseStatus: "offline",
        lastEntryIso: new Date(NOW).toISOString(),
        llmStatus: "ok",
        nowMs: NOW,
      }),
    ).toBe("offline");
  });

  it("reconnecting beats llm_degraded / stale / live", () => {
    expect(
      computeHealthState({
        sseStatus: "reconnecting",
        lastEntryIso: new Date(NOW).toISOString(),
        llmStatus: "degraded",
        nowMs: NOW,
      }),
    ).toBe("reconnecting");
  });

  it("llm_degraded surfaces when SSE is live but LLM is down", () => {
    expect(
      computeHealthState({
        sseStatus: "live",
        lastEntryIso: new Date(NOW).toISOString(),
        llmStatus: "down",
        nowMs: NOW,
      }),
    ).toBe("llm_degraded");
    expect(
      computeHealthState({
        sseStatus: "live",
        lastEntryIso: new Date(NOW).toISOString(),
        llmStatus: "degraded",
        nowMs: NOW,
      }),
    ).toBe("llm_degraded");
  });

  it("stale when SSE is live but newest entry is older than 60s", () => {
    expect(
      computeHealthState({
        sseStatus: "live",
        lastEntryIso: new Date(NOW - 61_000).toISOString(),
        llmStatus: "ok",
        nowMs: NOW,
      }),
    ).toBe("stale");
  });

  it("live within the 60s threshold", () => {
    expect(
      computeHealthState({
        sseStatus: "live",
        lastEntryIso: new Date(NOW - 30_000).toISOString(),
        llmStatus: "ok",
        nowMs: NOW,
      }),
    ).toBe("live");
  });

  it("live when there are no entries yet (nothing to be stale about)", () => {
    expect(
      computeHealthState({
        sseStatus: "live",
        lastEntryIso: undefined,
        llmStatus: "ok",
        nowMs: NOW,
      }),
    ).toBe("live");
  });
});

describe("formatHealthChromeLabel", () => {
  it("uses compact 'live · Ns lag' when entries exist", () => {
    expect(formatHealthChromeLabel("live", 3)).toBe("live · 3s lag");
    expect(formatHealthChromeLabel("live", 120)).toBe("live · 2m lag");
  });

  it("falls back to 'live' when lag is unknown", () => {
    expect(formatHealthChromeLabel("live", null)).toBe("live");
  });

  it("renders distinct labels for each non-live state", () => {
    expect(formatHealthChromeLabel("stale", 90)).toBe("stale · 1m lag");
    expect(formatHealthChromeLabel("reconnecting", null)).toBe("reconnecting");
    expect(formatHealthChromeLabel("offline", null)).toBe("offline · tap to retry");
    expect(formatHealthChromeLabel("llm_degraded", null)).toBe("LLM degraded");
  });
});

describe("formatHealthFooterLabel", () => {
  it("uses 'SSE'-prefixed wording for the footer variant", () => {
    expect(formatHealthFooterLabel("live", 5)).toBe("SSE live");
    expect(formatHealthFooterLabel("reconnecting", null)).toBe("SSE reconnecting");
    expect(formatHealthFooterLabel("offline", null)).toBe("SSE offline");
  });

  it("includes lag in stale label", () => {
    expect(formatHealthFooterLabel("stale", 240)).toBe("SSE stale · 4m lag");
  });

  it("renders the LLM degraded label", () => {
    expect(formatHealthFooterLabel("llm_degraded", 0)).toBe("LLM degraded");
  });
});

describe("healthDotColor", () => {
  it("maps each health state to a tier-colored token", () => {
    expect(healthDotColor("live")).toBe("var(--cl-risk-low)");
    expect(healthDotColor("stale")).toBe("var(--cl-risk-medium)");
    expect(healthDotColor("reconnecting")).toBe("var(--cl-risk-medium)");
    expect(healthDotColor("llm_degraded")).toBe("var(--cl-risk-medium)");
    expect(healthDotColor("offline")).toBe("var(--cl-risk-high)");
  });
});

// ── prefs round-trip via FLEET_RANGE ─────────────────────────

/**
 * Smoke-test that the canonical pref key remains "cl:fleet:range" — this is
 * the key the fleet header reads/writes. A rename without updating both sides
 * silently breaks the round-trip; a test here makes the regression loud.
 */
describe("FLEET_RANGE pref key contract", () => {
  let storage: Map<string, string>;

  beforeEach(async () => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
      key: (i: number) => Array.from(storage.keys())[i] ?? null,
      get length() {
        return storage.size;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a RangeOption through prefs.ts using the documented key", async () => {
    const { getPref, setPref, PREF_KEYS } = await import("../dashboard/src/lib/prefs");
    expect(PREF_KEYS.FLEET_RANGE).toBe("cl:fleet:range");

    setPref(PREF_KEYS.FLEET_RANGE, "6h");
    expect(getPref<string>(PREF_KEYS.FLEET_RANGE, "12h")).toBe("6h");

    // A historical bad value should be rejected by the type guard before
    // reaching <RangeOption> consumers.
    setPref(PREF_KEYS.FLEET_RANGE, "48h");
    const raw = getPref<string>(PREF_KEYS.FLEET_RANGE, "12h");
    expect(isRangeOption(raw)).toBe(false);
  });
});
