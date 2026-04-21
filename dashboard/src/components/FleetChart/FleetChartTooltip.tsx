import type { ActivityCategory, TimelineSession } from "../../lib/types";
import { parseSessionKey } from "../../lib/channel-catalog";
import { riskColorRaw, riskTierFromScore } from "../../lib/utils";
import GradientAvatar from "../GradientAvatar";
import type { Cluster } from "./utils";
import { isPendingSession } from "./utils";

interface Props {
  cluster: Cluster;
  pos: { x: number; y: number };
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  pendingSessionKeys: ReadonlySet<string>;
  agentNameById: Map<string, string>;
}

const TOOLTIP_W = 260;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${Math.max(0, ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  exploring: "exploring",
  commands: "commands",
  web: "web",
  comms: "comms",
  changes: "changes",
  data: "data",
};

const CATEGORY_COLOR: Record<ActivityCategory, string> = {
  exploring: "var(--cl-cat-exploring)",
  changes: "var(--cl-cat-changes)",
  commands: "var(--cl-cat-commands)",
  web: "var(--cl-cat-web)",
  comms: "var(--cl-cat-comms)",
  data: "var(--cl-cat-data)",
};

function runSuffix(sessionKey: string): string | null {
  const m = sessionKey.match(/#(\d+)$/);
  return m ? `run #${m[1]}` : null;
}

function singleSessionTooltip(
  session: TimelineSession,
  pending: boolean,
  agentName: string,
) {
  const parsed = parseSessionKey(session.sessionKey);
  const channel = parsed?.channel;
  const tier = riskTierFromScore(session.peakRisk);
  const tierColor = riskColorRaw(tier);
  const duration = fmtDuration(session.startTime, session.endTime);
  const run = runSuffix(session.sessionKey);

  const catCounts = new Map<ActivityCategory, number>();
  for (const seg of session.segments) {
    catCounts.set(
      seg.category,
      (catCounts.get(seg.category) ?? 0) + (seg.actionCount ?? 1),
    );
  }
  const total = [...catCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const breakdown = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => ({ cat, pct: Math.round((count / total) * 100) }));
  const showBreakdown = catCounts.size > 1;

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <GradientAvatar agentId={session.agentId} size="xs" />
        <span
          style={{
            color: "var(--cl-text-primary)",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {agentName}
        </span>
        {run && (
          <span style={{ color: "var(--cl-text-muted)", fontSize: 10 }}>
            · {run}
          </span>
        )}
      </div>
      {channel && (
        <div
          style={{
            color: "var(--cl-text-muted)",
            fontSize: 10,
            marginBottom: 4,
          }}
        >
          {channel.kind === "schedule"
            ? "⏰"
            : channel.kind === "messaging"
              ? "💬"
              : channel.kind === "hook"
                ? "↯"
                : ""}{" "}
          {channel.label}
          {parsed && parsed.subPath.length > 0 && (
            <>
              {" · "}
              {parsed.subPath.join(":").replace(/#\d+$/, "")}
            </>
          )}
        </div>
      )}
      <div
        style={{
          color: "var(--cl-text-secondary)",
          fontSize: 11,
          marginBottom: 2,
          fontWeight: 600,
        }}
      >
        {fmtTime(session.startTime)} → {fmtTime(session.endTime)} ({duration})
      </div>
      <div
        style={{
          color: "var(--cl-text-secondary)",
          fontSize: 10,
          marginBottom: 6,
        }}
      >
        {session.actionCount} action{session.actionCount !== 1 ? "s" : ""} · peak{" "}
        <span style={{ color: tierColor, fontWeight: 600 }}>
          {tier.toUpperCase()} {session.peakRisk}
        </span>
      </div>
      {showBreakdown && (
        <div className="flex items-center gap-1" style={{ marginBottom: 6 }}>
          {breakdown.map(({ cat, pct }) => (
            <span
              key={cat}
              className="flex items-center gap-1"
              style={{ fontSize: 9 }}
              title={CATEGORY_LABEL[cat]}
            >
              <span
                className="inline-block"
                style={{
                  width: Math.max(6, pct / 4),
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: CATEGORY_COLOR[cat],
                }}
              />
              <span style={{ color: "var(--cl-text-muted)" }}>{pct}%</span>
            </span>
          ))}
        </div>
      )}
      {session.blockedCount > 0 && (
        <div
          style={{
            color: "var(--cl-risk-high)",
            fontSize: 10,
            marginBottom: 2,
          }}
        >
          ⛔ {session.blockedCount} blocked
        </div>
      )}
      {pending && (
        <div
          style={{
            color: "var(--cl-risk-medium)",
            fontSize: 10,
            marginBottom: 2,
          }}
        >
          ⏳ waiting for approval
        </div>
      )}
      <div style={{ color: "var(--cl-accent)", fontSize: 9, marginTop: 2 }}>
        ↗ Click to view →
      </div>
    </>
  );
}

function clusterTooltip(cluster: Cluster, agentName: string) {
  const [first, ...rest] = [...cluster.sessions].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
  const last = rest.length > 0 ? rest[rest.length - 1] : first;
  const tier = riskTierFromScore(cluster.peakRisk);
  const tierColor = riskColorRaw(tier);
  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <GradientAvatar agentId={first.agentId} size="xs" />
        <span
          style={{
            color: "var(--cl-text-primary)",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {agentName}
        </span>
      </div>
      <div
        style={{
          color: "var(--cl-text-secondary)",
          fontSize: 11,
          marginBottom: 2,
          fontWeight: 600,
        }}
      >
        {cluster.sessions.length} sessions · {fmtTime(first.startTime)} –{" "}
        {fmtTime(last.endTime)}
      </div>
      <div
        style={{
          color: "var(--cl-text-secondary)",
          fontSize: 10,
          marginBottom: 6,
        }}
      >
        peak{" "}
        <span style={{ color: tierColor, fontWeight: 600 }}>
          {tier.toUpperCase()} {cluster.peakRisk}
        </span>
      </div>
      {cluster.blockedCount > 0 && (
        <div
          style={{
            color: "var(--cl-risk-high)",
            fontSize: 10,
            marginBottom: 2,
          }}
        >
          ⛔ {cluster.blockedCount} blocked across cluster
        </div>
      )}
      <div style={{ color: "var(--cl-accent)", fontSize: 9, marginTop: 2 }}>
        ↗ Click to expand →
      </div>
    </>
  );
}

export default function FleetChartTooltip({
  cluster,
  pos,
  wrapperRef,
  pendingSessionKeys,
  agentNameById,
}: Props) {
  const wrapperW = wrapperRef.current?.offsetWidth ?? 800;
  const wrapperH = wrapperRef.current?.offsetHeight ?? 400;
  let left = pos.x - TOOLTIP_W / 2;
  left = Math.max(4, Math.min(left, wrapperW - TOOLTIP_W - 4));
  const flipBelow = pos.y < wrapperH / 3;
  const top = flipBelow ? pos.y + 18 : pos.y - 12;
  const transform = flipBelow ? undefined : "translateY(-100%)";

  const agentId = cluster.sessions[0]?.agentId ?? "";
  const agentName = agentNameById.get(agentId) ?? agentId;

  return (
    <div
      role="tooltip"
      data-cl-fleet-tooltip
      className="cl-card"
      style={{
        position: "absolute",
        left,
        top,
        transform,
        width: TOOLTIP_W,
        padding: "10px 14px",
        fontSize: 11,
        fontFamily: "var(--cl-font-mono, monospace)",
        boxShadow: "var(--cl-depth-pop)",
        pointerEvents: "none",
        zIndex: 10,
        animation: "cascade-in 0.15s ease-out both",
      }}
    >
      {cluster.isCluster
        ? clusterTooltip(cluster, agentName)
        : singleSessionTooltip(
            cluster.sessions[0],
            isPendingSession(cluster.sessions[0].sessionKey, pendingSessionKeys),
            agentName,
          )}
    </div>
  );
}
