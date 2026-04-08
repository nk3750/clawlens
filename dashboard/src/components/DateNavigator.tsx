interface Props {
  selectedDate: string | null; // null = today, "YYYY-MM-DD" = past day
  onDateChange: (date: string | null) => void;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDay(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default function DateNavigator({ selectedDate, onDateChange }: Props) {
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

  return (
    <div className="flex items-center justify-center gap-4 py-6">
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
          padding: 8,
          fontSize: 18,
          lineHeight: 1,
        }}
        aria-label="Previous day"
      >
        &#8249;
      </button>

      <span
        className="text-sm font-medium tracking-widest uppercase select-none"
        style={{
          color: isToday ? "var(--cl-accent)" : "var(--cl-text-primary)",
          minWidth: 120,
          textAlign: "center",
        }}
      >
        {isToday ? "TODAY" : formatDate(viewing)}
      </span>

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
          padding: 8,
          fontSize: 18,
          lineHeight: 1,
        }}
        aria-label="Next day"
      >
        &#8250;
      </button>
    </div>
  );
}
