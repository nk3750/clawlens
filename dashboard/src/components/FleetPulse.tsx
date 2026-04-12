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

  // Day-over-day comparison
  const yesterdayTotal = stats.yesterdayTotal;
  const dayOverDay = (() => {
    if (yesterdayTotal === 0 && stats.total === 0) return null;
    if (yesterdayTotal === 0) return null; // no data for yesterday
    if (stats.total === yesterdayTotal) return { label: "— same", color: "var(--cl-text-muted)" };
    const pct = Math.round(((stats.total - yesterdayTotal) / yesterdayTotal) * 100);
    if (pct > 0) return { label: `↑ ${pct}%`, color: "var(--cl-text-secondary)" };
    return { label: `↓ ${Math.abs(pct)}%`, color: "var(--cl-text-secondary)" };
  })();

  // Active / idle agents
  const activeCount = stats.activeAgents;
  const idleCount = totalAgents - activeCount;

  return (
    <div>
      {/* Date row */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="font-sans text-sm font-medium tracking-widest uppercase select-none"
          style={{ color: isToday ? "var(--cl-accent)" : "var(--cl-text-primary)" }}
        >
          {isToday ? "TODAY" : formatDate(viewing)}
        </span>
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

      {/* Stat grid */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 rounded-xl overflow-hidden"
        style={{
          gap: "1px",
          background: "var(--cl-border-subtle)",
          border: "1px solid var(--cl-border-subtle)",
          borderRadius: 12,
        }}
      >
        {/* Cell 1: Actions */}
        <div className="flex flex-col items-center justify-center text-center" style={{ background: "var(--cl-surface)", padding: "16px 12px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cl-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 4 }}>
            <path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z" />
          </svg>
          <span className="font-mono text-2xl font-bold" style={{ color: "var(--cl-text-primary)" }}>
            {stats.total}
          </span>
          <span className="font-sans text-[11px]" style={{ color: "var(--cl-text-muted)" }}>
            actions
          </span>
          {dayOverDay && (
            <span className="font-mono text-[10px]" style={{ color: dayOverDay.color }}>
              {dayOverDay.label}
            </span>
          )}
        </div>

        {/* Cell 2: Active / Idle */}
        <div className="flex flex-col items-center justify-center text-center" style={{ background: "var(--cl-surface)", padding: "16px 12px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={activeCount > 0 ? "var(--cl-risk-low)" : "var(--cl-text-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 4 }}>
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
          <div className="flex items-baseline gap-0">
            <span
              className="font-mono text-2xl font-bold"
              style={{ color: activeCount > 0 ? "var(--cl-risk-low)" : "var(--cl-text-primary)" }}
            >
              {activeCount}
            </span>
            <span className="font-mono text-sm" style={{ color: "var(--cl-text-muted)" }}>
              {" / "}{idleCount}
            </span>
          </div>
          <span className="font-sans text-[11px]" style={{ color: "var(--cl-text-muted)" }}>
            active / idle
          </span>
        </div>

        {/* Cell 3: Blocked */}
        <div className="flex flex-col items-center justify-center text-center" style={{ background: "var(--cl-surface)", padding: "16px 12px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stats.blocked > 0 ? riskColorRaw("high") : "var(--cl-text-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 4 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span
            className="font-mono text-2xl font-bold"
            style={{ color: stats.blocked > 0 ? riskColorRaw("high") : "var(--cl-text-muted)" }}
          >
            {stats.blocked}
          </span>
          <span className="font-sans text-[11px]" style={{ color: "var(--cl-text-muted)" }}>
            blocked actions
          </span>
        </div>

        {/* Cell 4: Guardrails (clickable) */}
        <Link
          to="/guardrails"
          className="flex flex-col items-center justify-center text-center transition-colors"
          style={{ background: "var(--cl-surface)", padding: "16px 12px", textDecoration: "none" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--cl-elevated)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--cl-surface)"; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cl-text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 4 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span className="font-mono text-2xl font-bold" style={{ color: "var(--cl-text-primary)" }}>
            {guardrailCount}
          </span>
          <div className="flex items-center gap-1">
            <span className="font-sans text-[11px]" style={{ color: "var(--cl-text-muted)" }}>
              guardrails
            </span>
            <span className="text-[11px]" style={{ color: "var(--cl-text-muted)" }}>→</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
