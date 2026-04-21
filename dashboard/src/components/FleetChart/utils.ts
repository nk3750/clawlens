import type {
  ActivityCategory,
  SessionSegment,
  TimelineSession,
} from "../../lib/types";
import {
  parseSessionKey,
  resolveChannel,
  type ChannelMeta,
} from "../../lib/channel-catalog";
import type { RangeOption } from "../fleetheader/utils";

// ── Constants ────────────────────────────────────────────

export const CLUSTER_PX = 8;
/**
 * Dot radii for the fleet chart.
 *
 * - `DOT_SIZES_NORMAL`: fullscreen layout or any narrow (<900px) viewport
 *   where the chart already spans the full row.
 * - `DOT_SIZES_TIGHT`: bumped radii for the side-by-side bottom row where
 *   the chart shares width 50/50 with the LiveFeed. The extra 1px of radius
 *   keeps the dots readable at the compressed scale.
 */
export const DOT_SIZES_NORMAL = { routine: 4, attention: 6, cluster: 8 } as const;
export const DOT_SIZES_TIGHT = { routine: 5, attention: 7, cluster: 9 } as const;
export const ROW_HEIGHT_COMPACT = 44;
export const ROW_HEIGHT_EXPANDED = 56;
export const IDENTITY_WIDTH = 220;
export const TOTALS_WIDTH = 80;
export const IDENTITY_WIDTH_MOBILE = 40;
export const TOTALS_WIDTH_MOBILE = 48;
/** Maximum non-dormant rows rendered inline before the unified expander
 *  hides the rest behind a single "Show N more agents" button. Desktop. */
export const VISIBLE_ROW_CAP_DESKTOP = 10;
/** Same cap, mobile viewports (`measuredWidth < MOBILE_MAX_WIDTH`). */
export const VISIBLE_ROW_CAP_MOBILE = 6;
/** Minimum pixel distance an axis label must keep from the NOW marker.
 *  Labels closer than this are suppressed (the tick line still draws). */
export const NOW_LABEL_GUARD_PX = 24;

const MIN_MS = 60_000;
const DAY_MS = 24 * 3_600_000;
const MAX_CRON_INTERVAL_MS = 7 * DAY_MS;
/** Minimum median cadence we'll trust for next-run prediction (1 second). The
 *  backend's cadence.ts accepts sub-minute intervals — mirror that here so
 *  short-interval crons still get ghost markers. */
const MIN_CRON_MEDIAN_MS = 1_000;

// ── Session key helpers ──────────────────────────────────

/** Strip any trailing `#N` suffix from a split-session key. */
export function sessionKeyRoot(key: string): string {
  return key.replace(/#\d+$/, "");
}

/**
 * Resolve a sessionKey to its channel id with the split-session suffix
 * stripped. When a sessionKey has no subPath (e.g., `agent:a1:main#2`),
 * the backend's `#N` run counter lands on the channel segment itself — so
 * naive parsing produces "main#2" which misses the catalog lookup. Strip
 * it so runs on the same channel aggregate/predict correctly.
 */
export function channelIdFromKey(sessionKey: string): string {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return "unknown";
  return parsed.channel.id.replace(/#\d+$/, "");
}

/**
 * True when the chart session should display a pending crown. Attention
 * items carry raw keys while chart sessions may be split with `#N`, so we
 * match against both representations.
 */
export function isPendingSession(
  sessionKey: string,
  pendingSet: ReadonlySet<string>,
): boolean {
  if (pendingSet.has(sessionKey)) return true;
  const root = sessionKeyRoot(sessionKey);
  return root !== sessionKey && pendingSet.has(root);
}

// ── Cluster ──────────────────────────────────────────────

export interface Cluster {
  sessions: TimelineSession[];
  cx: number;
  isCluster: boolean;
  peakRisk: number;
  blockedCount: number;
  hasPending: boolean;
  hasActive: boolean;
}

/**
 * Group session dots that would overlap at the current scale. `timeToX`
 * encapsulates the current axis mapping so cluster results are already in
 * pixel space.
 */
export function cluster(
  sessions: TimelineSession[],
  timeToX: (ms: number) => number,
  pendingSet: ReadonlySet<string>,
): Cluster[] {
  if (sessions.length === 0) return [];
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
  const withX = sorted.map((s) => ({
    s,
    x: timeToX(new Date(s.startTime).getTime()),
  }));
  const out: Cluster[] = [];
  let group: { s: TimelineSession; x: number }[] = [];
  for (const item of withX) {
    if (group.length === 0 || item.x - group[group.length - 1].x < CLUSTER_PX) {
      group.push(item);
    } else {
      out.push(toCluster(group, pendingSet));
      group = [item];
    }
  }
  if (group.length > 0) out.push(toCluster(group, pendingSet));
  return out;
}

function toCluster(
  group: { s: TimelineSession; x: number }[],
  pendingSet: ReadonlySet<string>,
): Cluster {
  const cx = group.reduce((sum, g) => sum + g.x, 0) / group.length;
  let peakRisk = 0;
  let blockedCount = 0;
  let hasPending = false;
  let hasActive = false;
  for (const { s } of group) {
    if (s.peakRisk > peakRisk) peakRisk = s.peakRisk;
    blockedCount += s.blockedCount;
    if (isPendingSession(s.sessionKey, pendingSet)) hasPending = true;
    if (s.isActive) hasActive = true;
  }
  return {
    sessions: group.map((g) => g.s),
    cx,
    isCluster: group.length > 1,
    peakRisk,
    blockedCount,
    hasPending,
    hasActive,
  };
}

// ── Channel aggregation ──────────────────────────────────

/**
 * Most-frequent channels seen across an agent's sessions in the window.
 * Used by the identity strip chips. `main` (direct) is usually omitted by
 * the caller since it's the default — we keep it here for completeness.
 */
export function channelsForAgent(
  agentId: string,
  sessions: TimelineSession[],
): ChannelMeta[] {
  const counts = new Map<string, { meta: ChannelMeta; count: number }>();
  for (const s of sessions) {
    if (s.agentId !== agentId) continue;
    const channelId = channelIdFromKey(s.sessionKey);
    const meta = resolveChannel(channelId);
    const hit = counts.get(meta.id);
    if (hit) hit.count += 1;
    else counts.set(meta.id, { meta, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .map((c) => c.meta);
}

/**
 * Catalog-hand-authored shortLabels are unique (tg, wa, sk…). For unknown
 * channels the catalog falls through to `id.slice(0, 2)` which collides
 * across different ids (maintenance/macro both "ma") — fall back to the
 * full id (truncated past 6 chars) so chips stay distinguishable.
 */
export function chipText(c: {
  shortLabel: string;
  id: string;
  kind: string;
}): string {
  if (c.kind !== "unknown" && c.shortLabel) return c.shortLabel;
  const src = c.id || "";
  if (!src) return "";
  return src.length > 6 ? `${src.slice(0, 5)}\u2026` : src;
}

/**
 * Channels that should appear as identity-strip chips for an agent. Wraps
 * `channelsForAgent` with the same surface filter the Identity component
 * uses (drop main, drop unknown, drop empty shortLabel, drop entries whose
 * chipText would be empty). Centralized so the dormancy classifier in
 * `FleetChart` and the chip renderer in `FleetChartIdentity` stay in sync.
 *
 * Schedule-channel dedupe (when a row already shows a `⏰ every Nh` chip)
 * is layered on top by the Identity component — it is conditional on the
 * derived scheduleLabel and does not belong here.
 */
export function surfacedChannelsForRow(
  agentId: string,
  sessions: TimelineSession[],
): ChannelMeta[] {
  return channelsForAgent(agentId, sessions).filter(
    (c) =>
      c.id !== "main" &&
      c.id !== "unknown" &&
      c.shortLabel !== "" &&
      chipText(c) !== "",
  );
}

// ── Next-run prediction (§2f mirror of backend cadence) ─

/**
 * Next expected cron run after `now`. Sources starts from the chart's
 * split sessions (each session startTime is a run start after the backend
 * has split by `#N`). Returns null if we can't infer a stable cadence.
 */
export function predictNextRun(
  agentId: string,
  sessions: TimelineSession[],
  now: number,
): number | null {
  const starts: number[] = [];
  for (const s of sessions) {
    if (s.agentId !== agentId) continue;
    if (channelIdFromKey(s.sessionKey) !== "cron") continue;
    starts.push(new Date(s.startTime).getTime());
  }
  if (starts.length < 2) return null;
  starts.sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    const diff = starts[i] - starts[i - 1];
    if (diff > 0) intervals.push(diff);
  }
  if (intervals.length === 0) return null;
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median < MIN_CRON_MEDIAN_MS || median > MAX_CRON_INTERVAL_MS) return null;
  const last = starts[starts.length - 1];
  let next = last + median;
  while (next <= now) next += median;
  return next;
}

// ── Density scale (7d mode) ──────────────────────────────

/** Background opacity for a day cell. Zero actions → 0 (no fill). */
export function densityScale(actions: number, maxActions: number): number {
  if (actions <= 0 || maxActions <= 0) return 0;
  return 0.15 + 0.65 * (actions / maxActions);
}

// ── Day buckets (7d mode) ────────────────────────────────

export interface DayBucket {
  /** Local midnight ms. */
  dayMs: number;
  /** Local YYYY-MM-DD. */
  iso: string;
  actions: number;
  peakRisk: number;
  topChannel: string;
}

function localMidnightMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toLocalIsoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Builds 7 day-buckets per agent, oldest→newest. Sessions are attributed
 * to their start-time's local day (spec §3e — day-spanning sessions are
 * rare enough to ignore for v1).
 */
export function bucketByDay(
  agents: readonly string[],
  sessions: TimelineSession[],
  now: number,
): Map<string, DayBucket[]> {
  const todayMs = localMidnightMs(now);
  const out = new Map<string, DayBucket[]>();
  for (const agentId of agents) {
    const buckets: DayBucket[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayMs = todayMs - i * DAY_MS;
      buckets.push({
        dayMs,
        iso: toLocalIsoDate(dayMs),
        actions: 0,
        peakRisk: 0,
        topChannel: "",
      });
    }
    out.set(agentId, buckets);
  }

  const channelCounts = new Map<string, Map<string, number>>();
  for (const s of sessions) {
    const agentBuckets = out.get(s.agentId);
    if (!agentBuckets) continue;
    const startMs = new Date(s.startTime).getTime();
    const sessionDayMs = localMidnightMs(startMs);
    const idx = agentBuckets.findIndex((b) => b.dayMs === sessionDayMs);
    if (idx === -1) continue;
    const bucket = agentBuckets[idx];
    bucket.actions += s.actionCount;
    if (s.peakRisk > bucket.peakRisk) bucket.peakRisk = s.peakRisk;

    const channelId = channelIdFromKey(s.sessionKey);
    const key = `${s.agentId}|${idx}`;
    const chanMap = channelCounts.get(key) ?? new Map<string, number>();
    chanMap.set(channelId, (chanMap.get(channelId) ?? 0) + s.actionCount);
    channelCounts.set(key, chanMap);
  }

  for (const [key, chanMap] of channelCounts) {
    const [agentId, idxStr] = key.split("|");
    const idx = Number(idxStr);
    const agentBuckets = out.get(agentId);
    if (!agentBuckets) continue;
    const top = [...chanMap.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) agentBuckets[idx].topChannel = top[0];
  }
  return out;
}

// ── Axis helpers ─────────────────────────────────────────

export function tickIntervalMs(range: RangeOption): number {
  switch (range) {
    case "1h":
      return 15 * MIN_MS;
    case "3h":
      return 30 * MIN_MS;
    case "6h":
    case "12h":
      return 60 * MIN_MS;
    case "24h":
      return 2 * 60 * MIN_MS;
    case "7d":
      return 12 * 60 * MIN_MS;
  }
}

export interface AxisTick {
  ms: number;
  label: string;
}

function fmtHour(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  if (m === 0) return `${h12}${ampm}`;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function buildAxisTicks(
  startMs: number,
  endMs: number,
  range: RangeOption,
): AxisTick[] {
  const interval = tickIntervalMs(range);
  const ticks: AxisTick[] = [];
  const firstTick = Math.ceil(startMs / interval) * interval;
  for (let t = firstTick; t <= endMs; t += interval) {
    ticks.push({ ms: t, label: fmtHour(t) });
  }
  return ticks;
}

/**
 * Hide labels whose pixel gap at render time is below the minimum. We keep
 * ticks but return a filtered label set so the axis can draw ticks without
 * labels where they'd collide (§2b).
 */
export function cullLabelsForWidth(
  ticks: AxisTick[],
  timeToX: (ms: number) => number,
  minGapPx = 40,
): Set<number> {
  const shown = new Set<number>();
  let lastX = Number.NEGATIVE_INFINITY;
  for (const t of ticks) {
    const x = timeToX(t.ms);
    if (x - lastX >= minGapPx) {
      shown.add(t.ms);
      lastX = x;
    }
  }
  return shown;
}

// ── Scale factory ────────────────────────────────────────

export function makeTimeToX(
  startMs: number,
  endMs: number,
  width: number,
): (ms: number) => number {
  const span = endMs - startMs || 1;
  return (ms: number) => ((ms - startMs) / span) * width;
}

// ── SSE reducer (§6a) ────────────────────────────────────

export interface SSEUpdate {
  agentId: string;
  sessionKey: string;
  category: ActivityCategory;
  risk: number;
  timestamp: string;
  isBlocked: boolean;
}

/**
 * Pure reducer: fold one SSE entry into the sessions list. Matches by raw
 * sessionKey OR any `#N` suffix and attaches to the most recent run so
 * split-session boundaries don't misattribute the event (§6a).
 */
export function reduceSSEEntry(
  prev: TimelineSession[],
  upd: SSEUpdate,
): TimelineSession[] {
  const { agentId, sessionKey, category, risk, timestamp, isBlocked } = upd;
  const candidates = prev.filter(
    (s) =>
      s.agentId === agentId &&
      (s.sessionKey === sessionKey ||
        s.sessionKey.startsWith(`${sessionKey}#`)),
  );
  const existing = candidates.length
    ? candidates.reduce((a, b) => (a.endTime >= b.endTime ? a : b))
    : undefined;

  if (existing) {
    return prev.map((s) => {
      if (s !== existing) return s;
      const newEnd = timestamp > s.endTime ? timestamp : s.endTime;
      const lastSeg = s.segments[s.segments.length - 1];
      let newSegments: SessionSegment[];
      if (lastSeg && lastSeg.category === category) {
        newSegments = [
          ...s.segments.slice(0, -1),
          {
            ...lastSeg,
            endTime: timestamp,
            actionCount: (lastSeg.actionCount ?? 1) + 1,
          },
        ];
      } else {
        newSegments = [
          ...s.segments,
          {
            category,
            startTime: timestamp,
            endTime: timestamp,
            actionCount: 1,
          },
        ];
      }
      return {
        ...s,
        endTime: newEnd,
        segments: newSegments,
        actionCount: s.actionCount + 1,
        avgRisk: Math.round(
          (s.avgRisk * s.actionCount + risk) / (s.actionCount + 1),
        ),
        peakRisk: Math.max(s.peakRisk, risk),
        blockedCount: s.blockedCount + (isBlocked ? 1 : 0),
        isActive: true,
      };
    });
  }
  return [
    ...prev,
    {
      sessionKey,
      agentId,
      startTime: timestamp,
      endTime: timestamp,
      segments: [
        { category, startTime: timestamp, endTime: timestamp, actionCount: 1 },
      ],
      actionCount: 1,
      avgRisk: risk,
      peakRisk: risk,
      blockedCount: isBlocked ? 1 : 0,
      isActive: true,
    },
  ];
}

// ── Attention gating ─────────────────────────────────────

/**
 * A session earns the attention treatment (larger dot + ring) when its
 * peak risk crosses the high threshold, it contains a block, or it's
 * currently pending approval.
 */
export function isAttentionSession(
  s: TimelineSession,
  pendingSet: ReadonlySet<string>,
): boolean {
  if (s.peakRisk >= 65) return true;
  if (s.blockedCount > 0) return true;
  if (isPendingSession(s.sessionKey, pendingSet)) return true;
  return false;
}

// ── Active breathing ring cap (§2c.6) ────────────────────

/**
 * Pick up to 2 sessions chart-wide that should render the active
 * breathing ring. One per agent (most recent), then globally top-2 by
 * endTime.
 */
export function pickBreathingRingSessions(
  sessions: readonly TimelineSession[],
  range: RangeOption,
  cap = 2,
): Set<string> {
  if (range !== "1h" && range !== "3h") return new Set();
  const perAgent = new Map<string, TimelineSession>();
  for (const s of sessions) {
    if (!s.isActive) continue;
    const existing = perAgent.get(s.agentId);
    if (!existing || existing.endTime < s.endTime) perAgent.set(s.agentId, s);
  }
  const ranked = [...perAgent.values()].sort((a, b) =>
    b.endTime.localeCompare(a.endTime),
  );
  return new Set(ranked.slice(0, cap).map((s) => s.sessionKey));
}
