import { useSSEStatus } from "../hooks/useSSEStatus";
import {
  formatAuditAge,
  formatGatewayUptime,
  formatSSEStatusLabel,
  formatVersionLabel,
  sseStatusColorVar,
} from "../lib/footerStatus";

const HELP_URL = "https://github.com/openclaw/openclaw#readme";

interface Props {
  /**
   * Phase-A defaults to undefined — the stats endpoint doesn't expose a last-
   * entry timestamp yet (comes with homepage-v3-stats-strip-spec). When wired
   * up, the footer refreshes the age every 30s via the parent's re-render.
   */
  lastEntryIso?: string | null;
  /** Phase-A: no backend source yet. Placeholder until nav-chrome spec lands. */
  gatewayUptimeMs?: number | null;
}

export default function PageFooter({ lastEntryIso, gatewayUptimeMs }: Props) {
  const status = useSSEStatus();
  // Read build-time version injected by vite.config.ts (defines __APP_VERSION__).
  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

  const statusLabel = formatSSEStatusLabel(status);
  const statusColor = sseStatusColorVar(status);
  const versionLabel = formatVersionLabel(version);
  const auditLabel = formatAuditAge(lastEntryIso, Date.now());
  const uptimeLabel = formatGatewayUptime(gatewayUptimeMs);

  const reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  return (
    <footer
      role="contentinfo"
      className="label-mono"
      style={{
        borderTop: "1px solid var(--cl-border-subtle)",
        marginTop: 24,
        padding: "8px clamp(16px, 2.5vw, 32px)",
        minHeight: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        color: "var(--cl-text-muted)",
        fontSize: 10.5,
        letterSpacing: "0.08em",
      }}
    >
      <div className="flex items-center" style={{ gap: 10, flexWrap: "wrap" }}>
        <span>{versionLabel}</span>
        <Separator />
        <span className="flex items-center" style={{ gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
            }}
          />
          <span style={{ color: "var(--cl-text-secondary)" }}>{statusLabel}</span>
        </span>
        <Separator />
        <span>{auditLabel}</span>
        <span className="cl-wide-only">
          <Separator />
        </span>
        <span className="cl-wide-only">{uptimeLabel}</span>
      </div>

      <div className="flex items-center" style={{ gap: 4 }}>
        <a
          href={HELP_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Help"
          title="Help"
          className="btn-press"
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: "var(--cl-radius-sm, 6px)",
            color: "var(--cl-text-muted)",
            textDecoration: "none",
          }}
        >
          ?
        </a>
        <button
          type="button"
          onClick={reload}
          aria-label="Refresh"
          title="Refresh"
          className="btn-press"
          style={{
            width: 22,
            height: 22,
            display: "inline-grid",
            placeItems: "center",
            border: "none",
            background: "none",
            borderRadius: "var(--cl-radius-sm, 6px)",
            color: "var(--cl-text-muted)",
            cursor: "pointer",
          }}
        >
          ↻
        </button>
      </div>
    </footer>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" style={{ color: "var(--cl-text-muted)", opacity: 0.6 }}>
      ·
    </span>
  );
}
