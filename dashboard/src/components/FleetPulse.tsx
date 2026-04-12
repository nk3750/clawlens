import { Link } from "react-router-dom";
import type { StatsResponse } from "../lib/types";
import { riskColorRaw } from "../lib/utils";

interface Props {
  stats: StatsResponse;
  totalAgents: number;
  guardrailCount: number;
  selectedDate: string | null;
  onDateChange: (date: string | null) => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDay(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();
}

export default function FleetPulse({ stats, totalAgents, guardrailCount, selectedDate, onDateChange }: Props) {
  const today = todayISO();
  const viewing = selectedDate ?? today;
  const isToday = viewing === today;

  const minDate = shiftDay(today, -7);
  const canGoBack = viewing > minDate;
  const canGoForward = !isToday;

  const goBack = () => {
    if (!canGoBack) return;
    const prev = shiftDay(viewing, -1);
    onDateChange(prev === today ? null : prev);
  };

  const goForward = () => {
    if (!canGoForward) return;
    const next = shiftDay(viewing, 1);
    onDateChange(next === today ? null : next);
  };

  // Risk distribution bar
  const { low, medium, high, critical } = stats.riskBreakdown;
  const riskTotal = low + medium + high + critical;
  const tiers = [
    { key: "low", count: low, color: riskColorRaw("low") },
    { key: "medium", count: medium, color: riskColorRaw("medium") },
    { key: "high", count: high, color: riskColorRaw("high") },
    { key: "critical", count: critical, color: riskColorRaw("critical") },
  ] as const;

  return (
    <div className="page-enter">
      {/* Row 1: Date label + stats + nav */}
      <div
        className="font-mono text-xs flex items-center gap-2 flex-wrap"
        style={{ color: "var(--cl-text-secondary)" }}
      >
        <span
          className="text-sm font-medium tracking-widest uppercase select-none font-sans"
          style={{ color: isToday ? "var(--cl-accent)" : "var(--cl-text-primary)" }}
        >
          {isToday ? "TODAY" : formatDate(viewing)}
        </span>
        <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
        <span>{totalAgents} agents</span>
        <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
        <span>{stats.activeSessions} active</span>
        <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
        <span>{stats.total} actions</span>
        <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
        <span style={{ color: stats.blocked > 0 ? riskColorRaw("high") : undefined }}>
          {stats.blocked} blocked
        </span>
        {stats.timedOut > 0 && (
          <>
            <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
            <span style={{ color: riskColorRaw("medium") }}>
              {stats.timedOut} timed out
            </span>
          </>
        )}
        <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
        <Link
          to="/guardrails"
          className="inline-flex items-center gap-1 transition-colors"
          style={{ color: "var(--cl-text-secondary)" }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          {guardrailCount} guardrails
        </Link>
        <span className="flex-1" />
        <button
          type="button"
          onClick={goBack}
          disabled={!canGoBack}
          className="transition-opacity duration-150"
          style={{
            color: "var(--cl-text-muted)",
            opacity: canGoBack ? 1 : 0.25,
            cursor: canGoBack ? "pointer" : "default",
            background: "none",
            border: "none",
            padding: 4,
            fontSize: 18,
            lineHeight: 1,
          }}
          aria-label="Previous day"
        >
          &#8249;
        </button>
        <button
          type="button"
          onClick={goForward}
          disabled={!canGoForward}
          className="transition-opacity duration-150"
          style={{
            color: "var(--cl-text-muted)",
            opacity: canGoForward ? 1 : 0.25,
            cursor: canGoForward ? "pointer" : "default",
            background: "none",
            border: "none",
            padding: 4,
            fontSize: 18,
            lineHeight: 1,
          }}
          aria-label="Next day"
        >
          &#8250;
        </button>
      </div>

      {/* Row 3: Risk distribution bar */}
      {riskTotal > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <div
            className="flex-1 h-1.5 rounded-full overflow-hidden flex"
            style={{ backgroundColor: "var(--cl-elevated)" }}
          >
            {tiers.map(
              (t) =>
                t.count > 0 && (
                  <div
                    key={t.key}
                    style={{
                      width: `${(t.count / riskTotal) * 100}%`,
                      backgroundColor: t.color,
                    }}
                  />
                ),
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {tiers.map(
              (t) =>
                t.count > 0 && (
                  <span key={t.key} className="font-mono text-[10px]" style={{ color: t.color }}>
                    {t.count} {t.key === "critical" ? "crit" : t.key === "medium" ? "med" : t.key}
                  </span>
                ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
