import { Link } from "react-router-dom";
import { formatDuration, riskColor, riskTierFromScore } from "../../lib/utils";
import type { SessionInfo } from "../../lib/types";
import GradientAvatar from "../GradientAvatar";
import RiskTierStrip from "./RiskTierStrip";

interface Props {
  session: SessionInfo;
}

const PEAK_WARN_THRESHOLD = 60;

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Single row in the Sessions feed. Two-line, 64-72px tall, fixed-grid columns
 * per spec §5.4. Whole row is clickable — wrapped in a `<Link>` to the
 * existing /session/<key> detail page (no inline expand per §3 / §11).
 *
 * Active sessions (endTime null) render a pulsing green dot in the time
 * column and `LIVE` instead of duration in the meta column.
 */
export default function SessionRow({ session }: Props) {
  const isLive = session.endTime === null;
  const tier = riskTierFromScore(session.avgRisk);
  const showPeakWarn = session.peakRisk >= PEAK_WARN_THRESHOLD;

  return (
    <Link
      data-testid="session-row-link"
      to={`/session/${encodeURIComponent(session.sessionKey)}`}
      style={{
        display: "grid",
        gridTemplateColumns: "64px 1fr 160px 168px",
        alignItems: "center",
        gap: 14,
        padding: "10px 14px",
        minHeight: 64,
        textDecoration: "none",
        color: "inherit",
        borderBottom: "1px solid var(--cl-border-subtle)",
        background: "transparent",
        transition: "background var(--cl-dur-fast) var(--cl-ease)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--cl-bg-02)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Column 1 — start time (with optional LIVE dot) */}
      <div
        data-testid="session-row-time"
        className="mono"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--cl-text-muted)",
        }}
      >
        {isLive && (
          <span
            data-testid="session-row-live-dot"
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--cl-risk-low)",
              animation: "cl-pulse 2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
        )}
        <span>{formatHHMM(session.startTime)}</span>
      </div>

      {/* Column 2 — agent identity + channel context */}
      <div
        data-testid="session-row-agent"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <GradientAvatar agentId={session.agentId} size="xs" />
        <span
          style={{
            fontSize: 13,
            color: "var(--cl-text-primary)",
            fontWeight: 510,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 0,
          }}
        >
          {session.agentId}
        </span>
        {session.context && (
          <span
            style={{
              fontSize: 12,
              color: "var(--cl-text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {" · "}
            {session.context}
          </span>
        )}
      </div>

      {/* Column 3 — risk-tier strip */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <RiskTierStrip scores={session.riskSparkline} />
      </div>

      {/* Column 4 — meta (action count · duration / LIVE; avg/peak) */}
      <div
        data-testid="session-row-meta"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          textAlign: "right",
          fontSize: 11,
          fontFamily: "var(--cl-font-mono)",
          color: "var(--cl-text-secondary)",
        }}
      >
        <span>
          {session.toolCallCount} actions ·{" "}
          {isLive ? (
            <span style={{ color: "var(--cl-risk-low)", fontWeight: 600 }}>LIVE</span>
          ) : (
            formatDuration(session.duration)
          )}
        </span>
        <span style={{ display: "inline-flex", justifyContent: "flex-end", gap: 8 }}>
          <span style={{ color: riskColor(tier) }}>avg {session.avgRisk}</span>
          <span style={{ color: "var(--cl-text-muted)" }}>peak {session.peakRisk}</span>
          {showPeakWarn && (
            <span
              data-testid="session-row-peak-warn"
              aria-label={`peak risk ${session.peakRisk}`}
              style={{ color: "var(--cl-risk-high)" }}
            >
              {"⚠"}
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}
