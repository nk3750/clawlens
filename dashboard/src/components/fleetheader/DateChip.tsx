import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatDateChipLabel,
  isDateSelectable,
  parseRetentionDays,
  quickDateOptions,
  shiftDay,
  todayLocalISO,
} from "./utils";

interface Props {
  /** YYYY-MM-DD when viewing a past day; null when viewing today. */
  selectedDate: string | null;
  onChange: (date: string | null) => void;
  /** Optional retention (e.g. "30d") from /api/config. Defaults to 30d. */
  retention?: string | null;
}

/**
 * "⏵ TODAY ▾" chip + popover date picker. Replaces the FleetPulse
 * `‹ TODAY ›` triad. Reuses the GuardrailModal portal pattern: a fixed
 * overlay catches click-outside, Escape closes, focus traps inside the
 * popover content while open.
 */
export default function DateChip({ selectedDate, onChange, retention }: Props) {
  const today = todayLocalISO();
  const viewing = selectedDate ?? today;
  const isToday = viewing === today;
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const retentionDays = parseRetentionDays(retention);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const select = useCallback(
    (iso: string) => {
      if (!isDateSelectable(iso, today, retentionDays)) return;
      onChange(iso === today ? null : iso);
      close();
    },
    [today, retentionDays, onChange, close],
  );

  // Escape closes; arrow nav inside the chip when popover is closed lets the
  // user step ±1 day from the chip itself.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Focus the first selectable day inside the popover on open so screen
  // readers and keyboard users land somewhere meaningful.
  useEffect(() => {
    if (!open) return;
    const first = popoverRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    first?.focus();
  }, [open]);

  function onChipKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((v) => !v);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = shiftDay(viewing, -1);
      if (isDateSelectable(prev, today, retentionDays)) {
        onChange(prev === today ? null : prev);
      }
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = shiftDay(viewing, 1);
      if (isDateSelectable(next, today, retentionDays)) {
        onChange(next === today ? null : next);
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(null);
    }
  }

  return (
    <span className="cl-fh-datechip" style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onChipKeyDown}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        className={`btn-press inline-flex items-center ${isToday ? "" : "cl-date-past"}`}
        style={{
          gap: 6,
          padding: "5px 10px",
          borderRadius: "var(--cl-radius-sm, 6px)",
          border: "1px solid var(--cl-border-subtle)",
          background: isToday ? "var(--cl-accent-7)" : "var(--cl-elevated)",
          color: isToday ? "var(--cl-accent)" : "var(--cl-text-primary)",
          cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="6 3 20 12 6 21 6 3" />
        </svg>
        <span>{formatDateChipLabel(viewing, today)}</span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Return to today"
          className="btn-press"
          style={{
            marginLeft: 4,
            width: 22,
            height: 22,
            borderRadius: "var(--cl-radius-sm, 6px)",
            border: "1px solid var(--cl-border-subtle)",
            background: "transparent",
            color: "var(--cl-text-muted)",
            cursor: "pointer",
            display: "inline-grid",
            placeItems: "center",
          }}
        >
          ×
        </button>
      )}

      {open &&
        createPortal(
          <DatePickerPopover
            id={popoverId}
            popoverRef={popoverRef}
            today={today}
            viewing={viewing}
            retentionDays={retentionDays}
            onSelect={select}
            onClose={close}
          />,
          document.body,
        )}
    </span>
  );
}

interface PopoverProps {
  id: string;
  popoverRef: React.RefObject<HTMLDivElement>;
  today: string;
  viewing: string;
  retentionDays: number;
  onSelect: (iso: string) => void;
  onClose: () => void;
}

function DatePickerPopover({
  id,
  popoverRef,
  today,
  viewing,
  retentionDays,
  onSelect,
  onClose,
}: PopoverProps) {
  const quick = quickDateOptions(today, retentionDays);
  const monthGrid = buildMonthGrid(viewing);

  function trapFocus(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusables = Array.from(
      popoverRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: "var(--cl-z-modal, 100)" as unknown as number,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pick a date"
        id={id}
        onKeyDown={trapFocus}
        style={{
          background: "var(--cl-surface)",
          border: "1px solid var(--cl-border-default)",
          borderRadius: "var(--cl-radius-lg, 10px)",
          padding: 14,
          minWidth: 280,
          maxWidth: 320,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          animation: "cascade-in 0.18s var(--cl-spring) both",
        }}
      >
        {/* Quick-pick strip */}
        <div
          className="flex flex-wrap"
          style={{ gap: 6, marginBottom: 10 }}
          aria-label="Quick pick"
        >
          {quick.map((opt) => {
            const active = opt.iso === viewing;
            return (
              <button
                key={opt.iso}
                type="button"
                disabled={opt.disabled}
                onClick={() => onSelect(opt.iso)}
                className="btn-press font-sans"
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  borderRadius: "var(--cl-radius-sm, 6px)",
                  border: "1px solid",
                  borderColor: active ? "var(--cl-accent)" : "var(--cl-border-subtle)",
                  background: active ? "var(--cl-accent)" : "transparent",
                  color: active
                    ? "var(--cl-bg)"
                    : opt.disabled
                      ? "var(--cl-text-muted)"
                      : "var(--cl-text-primary)",
                  opacity: opt.disabled ? 0.4 : 1,
                  cursor: opt.disabled ? "not-allowed" : "pointer",
                  fontWeight: active ? 700 : 500,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Calendar grid */}
        <div
          role="grid"
          aria-label={`Calendar for ${monthGrid.monthLabel}`}
          className="font-mono"
          style={{ fontSize: 11 }}
        >
          <div
            style={{
              fontWeight: 600,
              color: "var(--cl-text-secondary)",
              textAlign: "center",
              marginBottom: 6,
              fontFamily: "'DM Sans', sans-serif",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {monthGrid.monthLabel}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 2,
              color: "var(--cl-text-muted)",
              marginBottom: 4,
            }}
          >
            {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
              <span key={`hdr-${idx}-${d}`} style={{ textAlign: "center", fontSize: 10 }}>
                {d}
              </span>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {monthGrid.cells.map((cell) => {
              if (cell.iso === null) {
                return <span key={cell.key} aria-hidden="true" />;
              }
              const selectable = isDateSelectable(cell.iso, today, retentionDays);
              const isViewing = cell.iso === viewing;
              const isTodayCell = cell.iso === today;
              return (
                <button
                  key={cell.key}
                  type="button"
                  disabled={!selectable}
                  onClick={() => selectable && cell.iso && onSelect(cell.iso)}
                  aria-pressed={isViewing}
                  className="btn-press"
                  style={{
                    height: 28,
                    borderRadius: "var(--cl-radius-sm, 6px)",
                    border: isTodayCell
                      ? "1px solid var(--cl-accent)"
                      : "1px solid transparent",
                    background: isViewing ? "var(--cl-accent)" : "transparent",
                    color: isViewing
                      ? "var(--cl-bg)"
                      : selectable
                        ? "var(--cl-text-primary)"
                        : "var(--cl-text-muted)",
                    opacity: selectable ? 1 : 0.35,
                    cursor: selectable ? "pointer" : "not-allowed",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 11,
                    fontWeight: isViewing ? 700 : 400,
                  }}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface MonthCell {
  key: string;
  day: number | null;
  iso: string | null;
}

interface MonthGrid {
  monthLabel: string;
  cells: MonthCell[];
}

/** Build a Sun-first month grid for the given YYYY-MM-DD viewing date. */
function buildMonthGrid(viewing: string): MonthGrid {
  const d = new Date(`${viewing}T12:00:00`);
  const year = d.getFullYear();
  const month = d.getMonth();
  const firstOfMonth = new Date(year, month, 1, 12);
  const startWeekday = firstOfMonth.getDay(); // 0..6, Sun..Sat
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = firstOfMonth
    .toLocaleDateString("en-US", { month: "long", year: "numeric" })
    .toUpperCase();

  const cells: MonthCell[] = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ key: `lead-${i}`, day: null, iso: null });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ key: iso, day, iso });
  }
  // Pad to a multiple of 7 so the grid is always rectangular.
  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, day: null, iso: null });
  }

  return { monthLabel, cells };
}
