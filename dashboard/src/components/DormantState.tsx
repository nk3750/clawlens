/**
 * First-run empty panel. See homepage-v3-layout-spec §5.
 *
 * Rendered by Agents.tsx when stats loads with total === 0 and activeSessions
 * === 0 — i.e. nothing has happened on the window we're viewing. Deliberately
 * static: no animations, no data fetches of its own.
 */
export default function DormantState() {
  const quickstartUrl = "https://github.com/openclaw/openclaw#readme";
  const configureUrl = "https://openclaw.ai/";

  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{
        minHeight: 320,
        padding: "48px 24px",
        background: "var(--cl-surface)",
        border: "1px solid var(--cl-border-default)",
        borderRadius: "var(--cl-radius-md, 8px)",
      }}
    >
      {/* Mark */}
      <div
        aria-hidden="true"
        style={{
          width: 48,
          height: 48,
          display: "grid",
          placeItems: "center",
          marginBottom: 16,
          color: "var(--cl-accent)",
        }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <polygon
            points="12,2 22,7 22,17 12,22 2,17 2,7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinejoin="round"
            opacity="0.65"
          />
          <circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.85" />
        </svg>
      </div>

      <p
        className="font-display font-semibold"
        style={{
          color: "var(--cl-text-primary)",
          fontSize: "var(--text-subhead)",
          marginBottom: 8,
          letterSpacing: "0.01em",
        }}
      >
        ClawLens is watching
      </p>

      <p
        className="text-sm"
        style={{
          color: "var(--cl-text-muted)",
          maxWidth: 440,
          marginBottom: 24,
          lineHeight: 1.55,
        }}
      >
        No agent activity yet. This is the observatory — once your agents run, you&rsquo;ll see
        them here.
      </p>

      <div className="flex flex-wrap items-center justify-center" style={{ gap: 10 }}>
        <a
          href={configureUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-press label-mono"
          style={{
            color: "var(--cl-accent)",
            border: "1px solid var(--cl-border-default)",
            borderRadius: "var(--cl-radius-md, 8px)",
            padding: "8px 14px",
            textDecoration: "none",
          }}
        >
          Configure OpenClaw →
        </a>
        <a
          href={quickstartUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-press label-mono"
          style={{
            color: "var(--cl-text-secondary)",
            border: "1px solid var(--cl-border-subtle)",
            borderRadius: "var(--cl-radius-md, 8px)",
            padding: "8px 14px",
            textDecoration: "none",
          }}
        >
          Read quickstart →
        </a>
      </div>
    </div>
  );
}
