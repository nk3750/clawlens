import type { ActivityCategory } from "../lib/types";
import { CATEGORY_META } from "../lib/utils";

interface Props {
  breakdown: Record<ActivityCategory, number>;
  showLabels?: boolean;
}

const ORDERED: ActivityCategory[] = [
  "exploring", "changes", "commands", "web", "comms", "data",
];

export default function ActivityBar({ breakdown, showLabels = true }: Props) {
  const segments = ORDERED.filter((cat) => breakdown[cat] > 0);
  // Top 2 for labels
  const top2 = [...segments]
    .sort((a, b) => breakdown[b] - breakdown[a])
    .slice(0, 2);

  return (
    <div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-cl-elevated">
        {segments.map((cat) => (
          <div
            key={cat}
            style={{
              width: `${breakdown[cat]}%`,
              backgroundColor: CATEGORY_META[cat].color,
            }}
          />
        ))}
      </div>
      {showLabels && top2.length > 0 && (
        <div className="flex gap-3 mt-1.5">
          {top2.map((cat) => (
            <span
              key={cat}
              className="label-mono"
              style={{ color: "var(--cl-text-muted)" }}
            >
              {CATEGORY_META[cat].label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
