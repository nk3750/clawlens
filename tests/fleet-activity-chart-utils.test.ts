import { describe, expect, it } from "vitest";
import {
  buildDayTicks,
  buildHourTicks,
  clusterDots,
  clusterPxForRange,
  cullLabelsForWidth,
  haloRadiusOffset,
  jitterForKey,
  LANE_ORDER,
  laneHeight,
  laneYForCategory,
  makeTimeToX,
  maxClusterTimeMsForRange,
  type SwarmDot,
  worstTier,
} from "../dashboard/src/components/FleetActivityChart/utils";
import { RANGE_OPTIONS } from "../dashboard/src/components/fleetheader/utils";
import type { ActivityCategory, EntryResponse, RiskTier } from "../dashboard/src/lib/types";

const DEFAULT_PX = clusterPxForRange("1h");
const DEFAULT_TIME_MS = maxClusterTimeMsForRange("7d");

function dot(partial: { cx?: number; cy?: number; entry?: Partial<EntryResponse> } = {}): SwarmDot {
  const entry: EntryResponse = {
    timestamp: "2026-04-20T12:00:00.000Z",
    toolName: "read",
    params: {},
    effectiveDecision: "allow",
    decision: "allow",
    category: "exploring",
    ...(partial.entry ?? {}),
  };
  return {
    entry,
    cx: partial.cx ?? 0,
    cy: partial.cy ?? 0,
  };
}

describe("LANE_ORDER", () => {
  it("lists the 8 categories in the exploring → media order (top to bottom)", () => {
    // orchestration sits next to comms (peer "boundary-crossing" buckets);
    // media stays last (creative output). Kept in lockstep with the spec's
    // canonical category order — see activity-category-coverage spec §9.
    expect(LANE_ORDER).toEqual([
      "exploring",
      "changes",
      "git",
      "scripts",
      "web",
      "comms",
      "orchestration",
      "media",
    ]);
  });
});

describe("clusterPxForRange", () => {
  it("returns a value for every RangeOption (exhaustive coverage)", () => {
    for (const r of RANGE_OPTIONS) {
      expect(typeof clusterPxForRange(r)).toBe("number");
      expect(Number.isFinite(clusterPxForRange(r))).toBe(true);
    }
  });

  it("decreases (or stays) as range grows — wider ranges cluster tighter", () => {
    let last = Number.POSITIVE_INFINITY;
    for (const r of RANGE_OPTIONS) {
      const v = clusterPxForRange(r);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });

  it("locks the canonical lookup table values", () => {
    expect(clusterPxForRange("1h")).toBe(14);
    expect(clusterPxForRange("3h")).toBe(14);
    expect(clusterPxForRange("6h")).toBe(12);
    expect(clusterPxForRange("12h")).toBe(10);
    expect(clusterPxForRange("24h")).toBe(8);
    expect(clusterPxForRange("48h")).toBe(6);
    expect(clusterPxForRange("7d")).toBe(5);
  });
});

describe("maxClusterTimeMsForRange", () => {
  it("returns a value for every RangeOption (exhaustive coverage)", () => {
    for (const r of RANGE_OPTIONS) {
      expect(typeof maxClusterTimeMsForRange(r)).toBe("number");
      expect(Number.isFinite(maxClusterTimeMsForRange(r))).toBe(true);
    }
  });

  it("locks the canonical time-span lookup table values (ms)", () => {
    expect(maxClusterTimeMsForRange("1h")).toBe(2 * 60_000);
    expect(maxClusterTimeMsForRange("3h")).toBe(5 * 60_000);
    expect(maxClusterTimeMsForRange("6h")).toBe(10 * 60_000);
    expect(maxClusterTimeMsForRange("12h")).toBe(30 * 60_000);
    expect(maxClusterTimeMsForRange("24h")).toBe(60 * 60_000);
    expect(maxClusterTimeMsForRange("48h")).toBe(120 * 60_000);
    expect(maxClusterTimeMsForRange("7d")).toBe(240 * 60_000);
  });

  it("non-decreasing as range grows — longer ranges allow longer cluster spans", () => {
    let last = 0;
    for (const r of RANGE_OPTIONS) {
      const v = maxClusterTimeMsForRange(r);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe("jitterForKey", () => {
  it("returns the same value for the same key (deterministic)", () => {
    expect(jitterForKey("abc", 100)).toBe(jitterForKey("abc", 100));
    expect(jitterForKey("xyz-123", 44)).toBe(jitterForKey("xyz-123", 44));
  });

  it("stays within ±17.5% of the supplied lane height", () => {
    const h = 60;
    for (const key of ["a", "bb", "ccc", "t0", "t99999", "call_01HZ"]) {
      const j = jitterForKey(key, h);
      expect(j).toBeGreaterThanOrEqual(-0.175 * h);
      expect(j).toBeLessThanOrEqual(0.175 * h);
    }
  });

  it("returns different values for different keys (distribution check)", () => {
    const values = new Set<number>();
    for (let i = 0; i < 50; i++) values.add(jitterForKey(`key-${i}`, 60));
    // Collisions are possible but with 50 keys and a ~1000-step bucket
    // they should be rare enough to pass a loose threshold.
    expect(values.size).toBeGreaterThan(30);
  });

  it("scales with lane height", () => {
    const small = Math.abs(jitterForKey("same-key", 20));
    const big = Math.abs(jitterForKey("same-key", 200));
    // big is 10× taller lane; jitter should be 10× larger for the same key.
    expect(big).toBeCloseTo(small * 10, 2);
  });
});

describe("laneYForCategory", () => {
  it("returns the lane center for each of the 8 categories, top to bottom", () => {
    // 240 chart height / 8 lanes = 30px per lane (preserves the 30px lane
    // height the prior 6-lane * 30px setup used after the rev-2 lane bump).
    const chartH = 240;
    const ys = LANE_ORDER.map((c) => laneYForCategory(c, chartH));
    // Strictly increasing — exploring at top (smallest y), media at bottom.
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
    // Top lane's center at half a lane height.
    expect(ys[0]).toBe(15);
    // Bottom lane's center at chartH - half a lane height.
    expect(ys[ys.length - 1]).toBe(chartH - 15);
  });

  it("scales with chart height (lane height = chartH / LANE_ORDER.length)", () => {
    const a = laneYForCategory("git", 120);
    const b = laneYForCategory("git", 240);
    // git is index 2; center = laneH * 2.5. With LANE_ORDER.length = 8 the
    // lane height tightens by 25% relative to 6 lanes — accepted per spec §9.
    expect(a).toBe((120 / LANE_ORDER.length) * 2.5);
    expect(b).toBe((240 / LANE_ORDER.length) * 2.5);
  });
});

describe("laneHeight", () => {
  it("returns 40 for chartHeight=320 (matches INLINE_CHART_HEIGHT, #46 v1.1 polish)", () => {
    // 320 / 8 lanes = 40px per lane. Regression guard against a quiet revert.
    // History: 200 (=25px lanes, original) → 280 (=35px, #46 first pass) →
    // 320 (=40px, #46 §8.1 pre-approved escalation after the live walk
    // showed +N cluster labels still felt cramped at 35px).
    expect(laneHeight(320)).toBe(40);
  });

  it("scales linearly with chartHeight (chartHeight / LANE_ORDER.length)", () => {
    expect(laneHeight(80)).toBe(10);
    expect(laneHeight(360)).toBe(45); // FULLSCREEN_CHART_HEIGHT
  });
});

describe("worstTier", () => {
  it("returns undefined for an empty list", () => {
    expect(worstTier([])).toBeUndefined();
  });

  it("returns critical when any source is critical", () => {
    expect(worstTier(["low", "high", "critical", "medium"])).toBe("critical");
  });

  it("returns high when the worst is high (no critical)", () => {
    expect(worstTier(["low", "medium", "high"])).toBe("high");
  });

  it("returns medium when the worst is medium", () => {
    expect(worstTier(["low", "medium", "low"])).toBe("medium");
  });

  it("returns low when every source is low", () => {
    expect(worstTier(["low", "low", "low"])).toBe("low");
  });

  it("ignores undefined entries", () => {
    const tiers: (RiskTier | undefined)[] = [undefined, "high", undefined];
    expect(worstTier(tiers)).toBe("high");
  });
});

describe("haloRadiusOffset", () => {
  it("returns 0 for low", () => {
    expect(haloRadiusOffset("low")).toBe(0);
  });
  it("returns 0 for medium (medium/low never halo)", () => {
    expect(haloRadiusOffset("medium")).toBe(0);
  });
  it("returns 3 for high", () => {
    expect(haloRadiusOffset("high")).toBe(3);
  });
  it("returns 4 for critical", () => {
    expect(haloRadiusOffset("critical")).toBe(4);
  });
  it("returns 0 for undefined", () => {
    expect(haloRadiusOffset(undefined)).toBe(0);
  });
});

describe("clusterDots", () => {
  it("returns [] for empty input", () => {
    expect(clusterDots([], DEFAULT_PX, DEFAULT_TIME_MS)).toEqual([]);
  });

  it("wraps a single dot in a non-cluster result", () => {
    const d = dot({ cx: 50, cy: 20, entry: { toolCallId: "a" } });
    const clusters = clusterDots([d], DEFAULT_PX, DEFAULT_TIME_MS);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].isCluster).toBe(false);
    expect(clusters[0].cx).toBe(50);
    expect(clusters[0].dots).toHaveLength(1);
  });

  it("merges dots whose cx falls within the threshold", () => {
    const dots = [
      dot({ cx: 100, cy: 10, entry: { toolCallId: "a" } }),
      dot({ cx: 104, cy: 11, entry: { toolCallId: "b" } }),
      dot({ cx: 107, cy: 10, entry: { toolCallId: "c" } }),
    ];
    const clusters = clusterDots(dots, DEFAULT_PX, DEFAULT_TIME_MS);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].isCluster).toBe(true);
    expect(clusters[0].dots).toHaveLength(3);
    // cx is the mean of 100, 104, 107.
    expect(clusters[0].cx).toBeCloseTo((100 + 104 + 107) / 3, 6);
  });

  it("keeps distant dots as separate clusters", () => {
    const dots = [
      dot({ cx: 10, entry: { toolCallId: "a" } }),
      dot({ cx: 100, entry: { toolCallId: "b" } }),
      dot({ cx: 200, entry: { toolCallId: "c" } }),
    ];
    const clusters = clusterDots(dots, DEFAULT_PX, DEFAULT_TIME_MS);
    expect(clusters).toHaveLength(3);
    for (const c of clusters) expect(c.isCluster).toBe(false);
  });

  it("sorts its input by cx ascending before clustering", () => {
    const dots = [
      dot({ cx: 107, entry: { toolCallId: "c" } }),
      dot({ cx: 100, entry: { toolCallId: "a" } }),
      dot({ cx: 104, entry: { toolCallId: "b" } }),
    ];
    const clusters = clusterDots(dots, DEFAULT_PX, DEFAULT_TIME_MS);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].dots.map((d) => d.entry.toolCallId)).toEqual(["a", "b", "c"]);
  });

  it("assigns the worst riskTier present across the cluster's sources", () => {
    const dots = [
      dot({ cx: 100, entry: { toolCallId: "a", riskTier: "low" } }),
      dot({ cx: 103, entry: { toolCallId: "b", riskTier: "critical" } }),
      dot({ cx: 106, entry: { toolCallId: "c", riskTier: "medium" } }),
    ];
    const clusters = clusterDots(dots, DEFAULT_PX, DEFAULT_TIME_MS);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].worstTier).toBe("critical");
  });

  it("uses the mean cy of the members so the cluster dot sits on the swarm", () => {
    const dots = [
      dot({ cx: 100, cy: 10, entry: { toolCallId: "a" } }),
      dot({ cx: 103, cy: 16, entry: { toolCallId: "b" } }),
      dot({ cx: 106, cy: 22, entry: { toolCallId: "c" } }),
    ];
    const [c] = clusterDots(dots, DEFAULT_PX, DEFAULT_TIME_MS);
    expect(c.cy).toBeCloseTo((10 + 16 + 22) / 3, 6);
  });
});

describe("clusterDots — time-span gate", () => {
  it("splits a pixel-adjacent pair when their time gap exceeds the cap", () => {
    const dots = [
      dot({ cx: 100, cy: 50, entry: { toolCallId: "a", timestamp: "2026-05-05T16:00:00.000Z" } }),
      dot({ cx: 102, cy: 50, entry: { toolCallId: "b", timestamp: "2026-05-05T17:00:00.000Z" } }),
    ];
    // pxThreshold loose (10px so the px gate passes); 1h > 30min cap → split.
    const out = clusterDots(dots, 10, 30 * 60_000);
    expect(out).toHaveLength(2);
    expect(out[0].dots[0].entry.toolCallId).toBe("a");
    expect(out[1].dots[0].entry.toolCallId).toBe("b");
  });

  it("keeps a pixel-adjacent pair when their time gap is within the cap", () => {
    const dots = [
      dot({ cx: 100, cy: 50, entry: { toolCallId: "a", timestamp: "2026-05-05T16:00:00.000Z" } }),
      dot({ cx: 102, cy: 50, entry: { toolCallId: "b", timestamp: "2026-05-05T16:10:00.000Z" } }),
    ];
    const out = clusterDots(dots, 10, 30 * 60_000);
    expect(out).toHaveLength(1);
    expect(out[0].dots).toHaveLength(2);
    expect(out[0].isCluster).toBe(true);
  });

  it("uses first-in-group, not last, for the time span — caps total span", () => {
    // Three dots evenly spaced at 20 min apart. With timeMs cap at 30 min,
    // the third dot's gap from the FIRST is 40 min, must split before it
    // even though its gap from the SECOND (last in group) is only 20 min.
    const dots = [
      dot({ cx: 100, cy: 50, entry: { toolCallId: "a", timestamp: "2026-05-05T16:00:00.000Z" } }),
      dot({ cx: 105, cy: 50, entry: { toolCallId: "b", timestamp: "2026-05-05T16:20:00.000Z" } }),
      dot({ cx: 110, cy: 50, entry: { toolCallId: "c", timestamp: "2026-05-05T16:40:00.000Z" } }),
    ];
    const out = clusterDots(dots, 50, 30 * 60_000);
    expect(out).toHaveLength(2);
    expect(out[0].dots).toHaveLength(2);
    expect(out[1].dots).toHaveLength(1);
    expect(out[0].dots.map((d) => d.entry.toolCallId)).toEqual(["a", "b"]);
    expect(out[1].dots.map((d) => d.entry.toolCallId)).toEqual(["c"]);
  });

  it("splits a same-time pair when pixel gap exceeds the cap", () => {
    const dots = [
      dot({ cx: 100, cy: 50, entry: { toolCallId: "a", timestamp: "2026-05-05T16:00:00.000Z" } }),
      dot({ cx: 130, cy: 50, entry: { toolCallId: "b", timestamp: "2026-05-05T16:00:00.000Z" } }),
    ];
    // px gap = 30, threshold = 10 → split despite identical timestamps.
    const out = clusterDots(dots, 10, 30 * 60_000);
    expect(out).toHaveLength(2);
  });

  it("invalid timestamps force a split (NaN gate is safe-default)", () => {
    const dots = [
      dot({ cx: 100, cy: 50, entry: { toolCallId: "a", timestamp: "2026-05-05T16:00:00.000Z" } }),
      dot({ cx: 102, cy: 50, entry: { toolCallId: "b", timestamp: "not-a-date" } }),
    ];
    const out = clusterDots(dots, 10, 30 * 60_000);
    expect(out).toHaveLength(2);
  });

  it("treats timeMsThreshold as inclusive (delta == cap merges)", () => {
    // Two dots exactly 30 minutes apart; with cap = 30min, must merge (≤ check).
    const dots = [
      dot({ cx: 100, cy: 50, entry: { toolCallId: "a", timestamp: "2026-05-05T16:00:00.000Z" } }),
      dot({ cx: 102, cy: 50, entry: { toolCallId: "b", timestamp: "2026-05-05T16:30:00.000Z" } }),
    ];
    const out = clusterDots(dots, 10, 30 * 60_000);
    expect(out).toHaveLength(1);
    expect(out[0].dots).toHaveLength(2);
  });
});

describe("makeTimeToX", () => {
  it("maps startMs → 0 and endMs → width", () => {
    const f = makeTimeToX(1000, 5000, 200);
    expect(f(1000)).toBe(0);
    expect(f(5000)).toBe(200);
  });

  it("interpolates linearly inside the window", () => {
    const f = makeTimeToX(1000, 2000, 100);
    expect(f(1500)).toBe(50);
  });

  it("returns values outside [0, width] for out-of-window timestamps", () => {
    const f = makeTimeToX(1000, 2000, 100);
    // 500ms before the window → negative x.
    expect(f(500)).toBeLessThan(0);
    // 500ms past the window end → x > width.
    expect(f(2500)).toBeGreaterThan(100);
  });
});

describe("buildHourTicks", () => {
  it("emits ticks at natural hour boundaries for a 3h window", () => {
    const now = new Date(2026, 3, 20, 12, 0, 0).getTime();
    const start = now - 3 * 3_600_000;
    const ticks = buildHourTicks(start, now, "3h");
    // Interval is 30 minutes for 3h — 6 or 7 ticks depending on alignment.
    expect(ticks.length).toBeGreaterThan(0);
    // Labels are all short hour/min strings (e.g. "9am", "9:30am").
    for (const t of ticks) {
      expect(t.label).toMatch(/^\d{1,2}(?::\d{2})?(?:am|pm)$/);
      expect(t.ms).toBeGreaterThanOrEqual(start);
      expect(t.ms).toBeLessThanOrEqual(now);
    }
  });
});

describe("buildDayTicks", () => {
  it("emits one tick per day spanned, at local midnight", () => {
    const start = new Date(2026, 3, 14, 0, 0, 0).getTime();
    const end = new Date(2026, 3, 20, 23, 59, 59).getTime();
    const ticks = buildDayTicks(start, end);
    // Covers 7 days.
    expect(ticks.length).toBe(7);
    // Labels are weekday short — Tue, Wed, …
    const labels = ticks.map((t) => t.label);
    expect(labels[0]).toMatch(/^[A-Z][a-z]{2}$/);
    // Every tick is at midnight (ms % day == 0 in the local tz).
    for (const t of ticks) {
      const d = new Date(t.ms);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    }
  });
});

describe("cullLabelsForWidth", () => {
  it("keeps labels that are far enough apart", () => {
    const ticks = [
      { ms: 1000, label: "a" },
      { ms: 2000, label: "b" },
      { ms: 3000, label: "c" },
    ];
    // 1-pixel-per-ms mapping — ticks are 1000px apart, well above the default gap.
    const kept = cullLabelsForWidth(ticks, (ms) => ms, 40);
    expect([...kept].sort()).toEqual([1000, 2000, 3000]);
  });

  it("drops labels that crowd each other below the min gap", () => {
    const ticks = [
      { ms: 0, label: "a" },
      { ms: 10, label: "b" },
      { ms: 20, label: "c" },
      { ms: 80, label: "d" },
    ];
    // 1-pixel-per-ms → first three are 10px apart, below 40. Keep 0 and 80.
    const kept = cullLabelsForWidth(ticks, (ms) => ms, 40);
    expect(kept.has(0)).toBe(true);
    expect(kept.has(80)).toBe(true);
    expect(kept.has(10)).toBe(false);
    expect(kept.has(20)).toBe(false);
  });
});

// Exhaustiveness sanity check — every ActivityCategory value must have a lane.
describe("lane coverage", () => {
  it("LANE_ORDER covers every ActivityCategory", () => {
    const all: ActivityCategory[] = [
      "exploring",
      "changes",
      "git",
      "scripts",
      "web",
      "comms",
      "orchestration",
      "media",
    ];
    for (const c of all) expect(LANE_ORDER).toContain(c);
    expect(LANE_ORDER.length).toBe(all.length);
  });
});
