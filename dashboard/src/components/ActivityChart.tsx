import type { EntryResponse } from "../lib/types";

/**
 * A tiny 24-hour activity sparkline. Shows patterns at a glance
 * without any numbers. Each bar = 1 hour of activity.
 */
export default function ActivityChart({ entries }: { entries: EntryResponse[] }) {
  const hours = new Array(24).fill(0);
  const now = Date.now();

  for (const e of entries) {
    const ageHours = (now - new Date(e.timestamp).getTime()) / (60 * 60 * 1000);
    if (ageHours < 24) {
      hours[23 - Math.floor(ageHours)]++;
    }
  }

  const max = Math.max(...hours, 1);

  return (
    <div className="flex items-end gap-[2px] h-8" title="Activity over last 24 hours">
      {hours.map((count, i) => {
        const height = count > 0 ? Math.max(3, (count / max) * 28) : 2;
        const isRecent = i >= 21; // last 3 hours
        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-all duration-500"
            style={{
              height: `${height}px`,
              backgroundColor: count > 0
                ? isRecent ? "#34d399" : "#34d39960"
                : "#1e213040",
              animationDelay: `${i * 20}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
