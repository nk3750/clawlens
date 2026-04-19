import type { RiskTier } from "../../lib/types";
import { resolveChannel } from "../../lib/channel-catalog";
import { riskColorRaw, riskTierFromScore } from "../../lib/utils";
import type { DayBucket } from "./utils";

interface Props {
  bucket: DayBucket;
  agentId: string;
  agentName: string;
  pos: { x: number; y: number };
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}

const TOOLTIP_W = 240;

function tierLabel(tier: RiskTier): string {
  return tier.toUpperCase();
}

function fmtDayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function FleetChartDayTooltip({
  bucket,
  agentId,
  agentName,
  pos,
  wrapperRef,
}: Props) {
  const wrapperW = wrapperRef.current?.offsetWidth ?? 800;
  const wrapperH = wrapperRef.current?.offsetHeight ?? 400;
  let left = pos.x - TOOLTIP_W / 2;
  left = Math.max(4, Math.min(left, wrapperW - TOOLTIP_W - 4));
  const flipBelow = pos.y < wrapperH / 3;
  const top = flipBelow ? pos.y + 18 : pos.y - 12;
  const transform = flipBelow ? undefined : "translateY(-100%)";

  const tier = riskTierFromScore(bucket.peakRisk);
  const tierColor = riskColorRaw(tier);
  const channel = bucket.topChannel ? resolveChannel(bucket.topChannel) : null;
  const channelLabel =
    channel && channel.id !== "main" && channel.id !== "unknown"
      ? channel.label
      : null;
  const hasActivity = bucket.actions > 0;

  return (
    <div
      role="tooltip"
      data-cl-fleet-day-tooltip
      data-cl-agent={agentId}
      style={{
        position: "absolute",
        left,
        top,
        transform,
        width: TOOLTIP_W,
        background: "var(--cl-elevated)",
        border: "1px solid var(--cl-border-subtle)",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 11,
        fontFamily: "var(--cl-font-mono, monospace)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      <div
        style={{
          color: "var(--cl-text-primary)",
          fontWeight: 600,
          fontSize: 12,
          marginBottom: 2,
        }}
      >
        {agentName}
      </div>
      <div
        style={{
          color: "var(--cl-text-secondary)",
          fontSize: 10,
          marginBottom: 4,
        }}
      >
        {fmtDayLabel(bucket.iso)}
      </div>
      {hasActivity ? (
        <>
          <div
            style={{
              color: "var(--cl-text-secondary)",
              fontSize: 11,
              marginBottom: 2,
            }}
          >
            {bucket.actions} action{bucket.actions !== 1 ? "s" : ""} · peak{" "}
            <span style={{ color: tierColor, fontWeight: 600 }}>
              {tierLabel(tier)}
            </span>
          </div>
          {channelLabel && (
            <div
              style={{
                color: "var(--cl-text-muted)",
                fontSize: 10,
                marginBottom: 2,
              }}
            >
              top channel: {channelLabel}
            </div>
          )}
        </>
      ) : (
        <div style={{ color: "var(--cl-text-muted)", fontSize: 10 }}>
          no activity
        </div>
      )}
      <div style={{ color: "var(--cl-accent)", fontSize: 9, marginTop: 4 }}>
        Click to view day →
      </div>
    </div>
  );
}
