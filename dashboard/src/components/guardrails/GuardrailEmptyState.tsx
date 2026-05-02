import { Link } from "react-router-dom";
import type { Guardrail } from "../../lib/types";
import { relTime } from "../../lib/utils";
import { ACTION_META, resourceKindFromTarget, shortPath } from "./shared";

interface Props {
  rules: Guardrail[];
  onSelect: (id: string) => void;
}

export default function GuardrailEmptyState({ rules, onSelect }: Props) {
  const hasRules = rules.length > 0;
  const totalHits24h = rules.reduce((acc, r) => acc + (r.hits24h ?? 0), 0);
  const blocking = rules.filter((r) => r.action === "block").length;
  const approvalGated = rules.filter((r) => r.action === "require_approval").length;
  const recentlyFired = rules
    .filter((r) => r.lastFiredAt)
    .sort((a, b) => (a.lastFiredAt && b.lastFiredAt ? b.lastFiredAt.localeCompare(a.lastFiredAt) : 0))
    .slice(0, 3);

  return (
    <div className="px-8 py-10 max-w-3xl">
      <div className="flex items-center gap-2 mb-6">
        <span
          aria-hidden
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: "var(--cl-accent)" }}
        />
        <span
          className="text-[10px]"
          style={{
            fontFamily: "var(--cl-font-mono)",
            letterSpacing: "0.08em",
            color: "var(--cl-text-muted)",
          }}
        >
          {rules.length} ACTIVE
        </span>
      </div>

      <h2
        className="mb-3"
        style={{
          fontSize: "28px",
          fontWeight: 510,
          lineHeight: 1.15,
          color: "var(--cl-text-primary)",
          fontFamily: "var(--cl-font-sans)",
        }}
      >
        Pick a guardrail to inspect or edit.
      </h2>
      <p
        className="text-[15px] mb-8 max-w-xl"
        style={{ color: "var(--cl-text-muted)", lineHeight: 1.55 }}
      >
        Each guardrail protects one resource — a file path, a command shape, or a URL pattern —
        across one or more tool verbs. Create new guardrails from any high-risk action in{" "}
        <Link
          to="/activity"
          style={{
            color: "var(--cl-accent)",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
          }}
        >
          Activity
        </Link>
        .
      </p>

      {hasRules && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-8">
            <Stat label="HITS · 24H" value={totalHits24h} />
            <Stat label="BLOCKING" value={blocking} />
            <Stat label="REQUIRE APPROVAL" value={approvalGated} />
          </div>

          {recentlyFired.length > 0 && (
            <div className="mb-8">
              <div
                className="text-[10px] mb-2"
                style={{
                  fontFamily: "var(--cl-font-mono)",
                  letterSpacing: "0.08em",
                  color: "var(--cl-text-muted)",
                }}
              >
                RECENTLY FIRED
              </div>
              <div
                className="rounded-lg overflow-hidden"
                style={{ border: "1px solid var(--cl-border-subtle)" }}
              >
                {recentlyFired.map((r) => (
                  <RecentRow key={r.id} rule={r} onSelect={() => onSelect(r.id)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Link
        to="/activity"
        className="block rounded-lg p-4 transition-colors"
        style={{
          border: "1px dashed var(--cl-border-strong)",
          color: "var(--cl-text-secondary)",
        }}
      >
        <div className="flex items-start gap-3">
          <span
            className="text-lg leading-none shrink-0"
            style={{ color: "var(--cl-text-muted)" }}
            aria-hidden
          >
            +
          </span>
          <div>
            <div
              className="text-sm font-medium mb-1"
              style={{ color: "var(--cl-text-primary)" }}
            >
              Add a guardrail
            </div>
            <div className="text-sm" style={{ color: "var(--cl-text-muted)" }}>
              Open Activity, find the action you want to gate, click [add guardrail].
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        backgroundColor: "var(--cl-elevated)",
        border: "1px solid var(--cl-border-subtle)",
      }}
    >
      <div
        className="text-[10px] mb-1"
        style={{
          fontFamily: "var(--cl-font-mono)",
          letterSpacing: "0.08em",
          color: "var(--cl-text-muted)",
        }}
      >
        {label}
      </div>
      <div
        className="text-2xl"
        style={{ fontFamily: "var(--cl-font-mono)", color: "var(--cl-text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}

function RecentRow({ rule, onSelect }: { rule: Guardrail; onSelect: () => void }) {
  const meta = ACTION_META[rule.action];
  const kind = resourceKindFromTarget(rule.target);
  const useMono = kind !== "url";
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`recent-fired-${rule.id}`}
      className="w-full text-left px-3 py-2 flex items-center gap-3 transition-colors"
      style={{
        backgroundColor: "transparent",
        borderBottom: "1px solid var(--cl-border-subtle)",
        cursor: "pointer",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={meta.color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="shrink-0"
      >
        <title>Guardrail shield</title>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      <span
        className="flex-1 truncate text-[13px]"
        style={{
          fontFamily: useMono ? "var(--cl-font-mono)" : "var(--cl-font-sans)",
          color: "var(--cl-text-primary)",
        }}
      >
        {shortPath(rule.target.pattern, 36)}
      </span>
      <span
        className="text-[10px] shrink-0"
        style={{
          fontFamily: "var(--cl-font-mono)",
          letterSpacing: "0.06em",
          color: meta.color,
        }}
      >
        {meta.mono}
      </span>
      <span
        className="text-[10px] shrink-0 w-12 text-right"
        style={{ color: "var(--cl-text-muted)" }}
      >
        {rule.lastFiredAt ? relTime(rule.lastFiredAt) : ""}
      </span>
      <span aria-hidden style={{ color: "var(--cl-text-muted)" }}>
        →
      </span>
    </button>
  );
}
