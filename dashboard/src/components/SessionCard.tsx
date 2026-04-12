import { Link } from "react-router-dom";
import type { SessionInfo } from "../lib/types";
import { relTime, riskTierFromScore, riskColor, riskColorRaw, formatDuration, CATEGORY_META } from "../lib/utils";

interface Props {
  session: SessionInfo;
}

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const w = 80;
  const h = 24;
  const step = data.length > 1 ? w / (data.length - 1) : 0;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" style={{ opacity: 0.7 }}>
      {data.map((val, i) => {
        const x = data.length === 1 ? w / 2 : i * step;
        const barH = Math.max(2, (val / max) * (h - 2));
        const tier = val > 75 ? "critical" : val > 50 ? "high" : val > 25 ? "medium" : "low";
        return (
          <rect
            key={i}
            x={x - 1.5}
            y={h - barH}
            width={3}
            height={barH}
            rx={1}
            fill={riskColorRaw(tier)}
            opacity={0.8}
          />
        );
      })}
    </svg>
  );
}

function ToolBreakdown({ session }: { session: SessionInfo }) {
  const tools = (session.toolSummary ?? []).slice(0, 3);
  if (tools.length === 0) return null;

  return (
    <div className="flex items-center gap-2.5 flex-wrap" style={{ fontSize: "11px" }}>
      {tools.map((t) => {
        const meta = CATEGORY_META[t.category];
        return (
          <span
            key={t.toolName}
            className="flex items-center gap-1 font-mono"
            style={{ color: meta?.color ?? "var(--cl-text-muted)" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={meta?.iconPath ?? ""} />
            </svg>
            {t.toolName}
            <span style={{ color: "var(--cl-text-secondary)" }}>{"\u00d7"}{t.count}</span>
          </span>
        );
      })}
    </div>
  );
}

export default function SessionCard({ session }: Props) {
  const tier = riskTierFromScore(session.avgRisk);
  const tierLabel =
    tier === "low" ? "Low" :
    tier === "medium" ? "Medium" :
    tier === "high" ? "High" : "Critical";
  return (
    <Link
      to={`/session/${encodeURIComponent(session.sessionKey)}`}
      className="cl-card block p-4 cursor-pointer shrink-0"
      style={{ width: "clamp(220px, 30vw, 280px)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="label-mono" style={{ color: "var(--cl-text-secondary)" }}>
          {relTime(session.startTime)}
        </span>
        {session.duration != null && (
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            {formatDuration(session.duration)}
          </span>
        )}
      </div>

      {session.context && (
        <p
          className="text-sm mb-2 truncate"
          style={{ color: "var(--cl-text-primary)" }}
        >
          {session.context}
        </p>
      )}

      {/* Tool breakdown */}
      <div className="mb-2">
        <ToolBreakdown session={session} />
      </div>

      {/* Mini risk sparkline */}
      {(session.riskSparkline ?? []).length > 0 && (
        <div className="mb-2">
          <MiniSparkline data={session.riskSparkline} />
        </div>
      )}

      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm" style={{ color: "var(--cl-text-primary)" }}>
          {session.toolCallCount} actions
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className="label-mono"
          style={{ color: riskColor(tier) }}
        >
          avg {session.avgRisk}
        </span>
        <span className="label-mono" style={{ color: "var(--cl-text-secondary)" }}>
          {tierLabel}
        </span>
        {session.blockedCount > 0 && (
          <span
            className="label-mono px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "rgba(248, 113, 113, 0.08)",
              color: "#f87171",
            }}
          >
            {session.blockedCount} blocked
          </span>
        )}
      </div>

    </Link>
  );
}
