import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { riskColorRaw, riskTierFromScore } from "../../lib/utils";
import type { Cluster } from "./utils";

interface Props {
  cluster: Cluster;
  pos: { x: number; y: number };
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  agentName: string;
  onClose: () => void;
}

const POPOVER_W = 280;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Cluster-click popover. Lists the sessions in the cluster with time/risk and
 * a link to each session detail. Closes on outside-click, Esc, or when the
 * parent unmounts. Deliberately minimal — this is the V1 cluster-expand
 * affordance (spec §2e, §11 mini-popover follow-up).
 */
export default function FleetChartClusterPopover({
  cluster,
  pos,
  wrapperRef,
  agentName,
  onClose,
}: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // useEffect runs after React has finished handling the click that opened
    // the popover, so attaching listeners synchronously is safe — the
    // opening event has already finished bubbling by the time we subscribe.
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const wrapperW = wrapperRef.current?.offsetWidth ?? 800;
  const wrapperH = wrapperRef.current?.offsetHeight ?? 400;
  let left = pos.x - POPOVER_W / 2;
  left = Math.max(4, Math.min(left, wrapperW - POPOVER_W - 4));
  const flipBelow = pos.y < wrapperH / 3;
  const top = flipBelow ? pos.y + 18 : pos.y - 12;
  const transform = flipBelow ? undefined : "translateY(-100%)";

  const rows = [...cluster.sessions].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`${cluster.sessions.length} sessions in cluster`}
      data-cl-fleet-cluster-popover
      style={{
        position: "absolute",
        left,
        top,
        transform,
        width: POPOVER_W,
        background: "var(--cl-elevated)",
        border: "1px solid var(--cl-border-subtle)",
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: 11,
        boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
        zIndex: 20,
        animation: "cascade-in 0.15s ease-out both",
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 6 }}
      >
        <span
          style={{
            color: "var(--cl-text-primary)",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {agentName} · {cluster.sessions.length} sessions
        </span>
        <button
          type="button"
          onClick={onClose}
          className="label-mono"
          aria-label="Close popover"
          style={{
            background: "none",
            border: "none",
            color: "var(--cl-text-muted)",
            fontSize: 14,
            lineHeight: 1,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <div className="flex flex-col" style={{ gap: 2 }}>
        {rows.map((s) => {
          const tier = riskTierFromScore(s.peakRisk);
          const tierColor = riskColorRaw(tier);
          const tierLabel =
            tier === "critical"
              ? "CRIT"
              : tier === "medium"
                ? "MED"
                : tier.toUpperCase();
          return (
            <Link
              key={s.sessionKey}
              to={`/session/${encodeURIComponent(s.sessionKey)}`}
              className="flex items-center gap-2 rounded no-underline"
              style={{
                padding: "4px 6px",
                color: "var(--cl-text-secondary)",
                textDecoration: "none",
                transition: "background-color 0.12s",
              }}
              data-cl-fleet-cluster-popover-row
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "color-mix(in srgb, var(--cl-accent) 8%, transparent)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "transparent";
              }}
            >
              <span
                className="font-mono tabular-nums"
                style={{ fontSize: 10, color: "var(--cl-text-primary)" }}
              >
                {fmtTime(s.startTime)}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 10,
                  color: "var(--cl-text-muted)",
                }}
              >
                {s.actionCount} action{s.actionCount !== 1 ? "s" : ""}
                {s.blockedCount > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "var(--cl-risk-high)" }}>
                      ⛔ {s.blockedCount}
                    </span>
                  </>
                )}
              </span>
              <span
                className="label-mono"
                style={{ fontSize: 10, color: tierColor }}
              >
                {tierLabel} {s.peakRisk}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
