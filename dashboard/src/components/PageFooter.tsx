import { useApi } from "../hooks/useApi";
import { formatAuditAge, formatGatewayUptime, formatVersionLabel } from "../lib/footerStatus";
import type { StatsResponse } from "../lib/types";
import HealthIndicator from "./fleetheader/HealthIndicator";

const HELP_URL = "https://github.com/openclaw/openclaw#readme";

interface Props {
  /** Phase-A: no backend source yet. Placeholder until nav-chrome spec lands. */
  gatewayUptimeMs?: number | null;
}

export default function PageFooter({ gatewayUptimeMs }: Props = {}) {
  // Self-fetch /api/stats so the footer is decoupled from the page tree.
  // /api/stats is small and the gateway returns it in <10ms — the cost is
  // dominated by per-page payloads, not this poll.
  const { data: stats } = useApi<StatsResponse>("api/stats");

  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
  const versionLabel = formatVersionLabel(version);
  const auditLabel = formatAuditAge(stats?.lastEntryTimestamp ?? null, Date.now());
  const uptimeLabel = formatGatewayUptime(gatewayUptimeMs);

  const reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  return (
    <footer
      role="contentinfo"
      className="label-mono"
      style={{
        background: "var(--cl-panel)",
        borderTop: "1px solid var(--cl-border-subtle)",
        marginTop: 24,
        padding: "8px clamp(16px, 2.5vw, 32px)",
        minHeight: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        color: "var(--cl-text-muted)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span>{versionLabel}</span>
        <Separator />
        <HealthIndicator
          variant="footer"
          lastEntryIso={stats?.lastEntryTimestamp ?? null}
          llmStatus={stats?.llmHealth?.status ?? null}
        />
        <Separator />
        <span>{auditLabel}</span>
        <span className="cl-wide-only">
          <Separator />
        </span>
        <span className="cl-wide-only">{uptimeLabel}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <a
          href={HELP_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Help"
          title="Help"
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: "var(--cl-r-sm)",
            color: "var(--cl-text-muted)",
            textDecoration: "none",
            transition: "color var(--cl-dur-fast) var(--cl-ease)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--cl-text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--cl-text-muted)";
          }}
        >
          ?
        </a>
        <button
          type="button"
          onClick={reload}
          aria-label="Refresh"
          title="Refresh"
          style={{
            width: 22,
            height: 22,
            display: "inline-grid",
            placeItems: "center",
            border: "none",
            background: "none",
            borderRadius: "var(--cl-r-sm)",
            color: "var(--cl-text-muted)",
            cursor: "pointer",
            transition: "color var(--cl-dur-fast) var(--cl-ease)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--cl-text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--cl-text-muted)";
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
    <span aria-hidden="true" style={{ color: "var(--cl-text-subdued)" }}>
      ·
    </span>
  );
}
