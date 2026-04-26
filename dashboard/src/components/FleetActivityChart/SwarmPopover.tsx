import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { EntryResponse, RiskTier } from "../../lib/types";
import { CATEGORY_META } from "../../lib/utils";
import type { SwarmCluster } from "./utils";

interface Props {
  cluster: SwarmCluster;
  anchor: { x: number; y: number };
  onClose: () => void;
  onNavigate: (entry: EntryResponse) => void;
}

const POPOVER_W = 300;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/**
 * Cluster drill-through. One row per source action, grouped vertically.
 * Click-through on the row navigates to `/session/:key` with
 * highlightToolCallId state so the session page scrolls to the exact entry.
 * Escape + outside-click close; the parent owns both listeners so nested
 * popovers don't collide.
 */
export default function SwarmPopover({ cluster, anchor, onClose, onNavigate }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Defer by a tick so the mousedown that opened the popover does not also
    // register as an outside-click on this listener.
    const id = setTimeout(() => {
      const onDoc = (e: MouseEvent) => {
        if (ref.current && ref.current.contains(e.target as Node)) return;
        onClose();
      };
      document.addEventListener("mousedown", onDoc);
      cleanupRef.current = () => document.removeEventListener("mousedown", onDoc);
    }, 0);
    const cleanupRef = { current: () => clearTimeout(id) };
    return () => cleanupRef.current();
  }, [onClose]);

  const rows = [...cluster.dots].sort((a, b) =>
    a.entry.timestamp.localeCompare(b.entry.timestamp),
  );

  // Clamp within the viewport — fixed positioning so anchor is page-space.
  const viewportW = typeof window !== "undefined" ? window.innerWidth : POPOVER_W + 16;
  const left = Math.max(8, Math.min(anchor.x - POPOVER_W / 2, viewportW - POPOVER_W - 8));
  const top = anchor.y + 12;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${cluster.dots.length} actions in cluster`}
      data-cl-swarm-popover
      className="cl-card"
      style={{
        position: "fixed",
        left,
        top,
        width: POPOVER_W,
        padding: "10px 12px",
        // Surface treatment mirrors RiskMixPopover so all hover/click popovers
        // share one visual language — opaque solid token + r-md radius +
        // spring entry animation. Without the explicit backgroundColor the
        // popover inherits .cl-card's translucent --cl-bg-02, which makes
        // chart content bleed through and kills readability.
        backgroundColor: "var(--cl-bg-popover)",
        border: "1px solid var(--cl-border)",
        borderRadius: "var(--cl-r-md)",
        boxShadow: "var(--cl-depth-pop)",
        animation: "cl-pop-in 160ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        transformOrigin: "top center",
        zIndex: 30,
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 6, gap: 8 }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: 12,
            color: "var(--cl-text-primary)",
          }}
        >
          {cluster.dots.length} actions
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close popover"
          style={{
            background: "none",
            border: "none",
            color: "var(--cl-text-muted)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <div className="flex flex-col" style={{ gap: 2 }}>
        {rows.map((d) => {
          const e = d.entry;
          const tier = e.riskTier as RiskTier | undefined;
          const meta = CATEGORY_META[e.category];
          const dotColor = meta?.color ?? "var(--cl-text-muted)";
          return (
            <button
              key={e.toolCallId ?? e.timestamp}
              type="button"
              data-cl-swarm-popover-row
              onClick={() => onNavigate(e)}
              className="flex items-center rounded"
              style={{
                gap: 8,
                padding: "4px 6px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--cl-text-secondary)",
                textAlign: "left",
                width: "100%",
              }}
              onMouseEnter={(ev) => {
                (ev.currentTarget as HTMLElement).style.backgroundColor =
                  "var(--cl-bg-05)";
              }}
              onMouseLeave={(ev) => {
                (ev.currentTarget as HTMLElement).style.backgroundColor =
                  "transparent";
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: dotColor,
                  flexShrink: 0,
                }}
              />
              <span
                className="font-mono tabular-nums"
                style={{ fontSize: 10, color: "var(--cl-text-primary)" }}
              >
                {fmtTime(e.timestamp)}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: "var(--cl-text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.agentId ?? "default"} · {e.toolName}
              </span>
              {(tier === "high" || tier === "critical") && (
                <span
                  className="label-mono"
                  style={{
                    fontSize: 10,
                    color:
                      tier === "critical"
                        ? "var(--cl-risk-critical)"
                        : "var(--cl-risk-high)",
                  }}
                >
                  {tier === "critical" ? "CRIT" : "HIGH"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
