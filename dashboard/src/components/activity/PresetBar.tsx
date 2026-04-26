import { PRESETS, presetMatches, type Filters, type Preset } from "../../lib/activityFilters";

interface Props {
  filters: Filters;
  onSelect: (preset: Preset) => void;
  /**
   * Phase 2.9 (#37) — compact viewport (≤768px). Switches the chip strip
   * from wrap (multi-row) to nowrap (single horizontal-scroll line) per
   * spec line 566. The parent (Activity.tsx) wraps this component in a
   * `overflow-x: auto` + `scrollbar-hide` container so the strip scrolls
   * cleanly without visible track chrome.
   */
  isCompact?: boolean;
}

/**
 * Six hardcoded URL-driven preset chips above the rail+feed grid. Clicking
 * a preset replaces the filter set with that preset's shape (no merge). The
 * active preset paints with `cl-bg-04` background; inactive presets use the
 * `cl-pill` styling.
 */
export default function PresetBar({ filters, onSelect, isCompact = false }: Props) {
  return (
    <div
      data-testid="preset-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: isCompact ? "nowrap" : "wrap",
        padding: "12px 0",
      }}
    >
      <span
        className="label-mono"
        style={{ fontSize: 10, color: "var(--cl-text-muted)", marginRight: 4 }}
      >
        URL PRESET
      </span>
      {PRESETS.map((preset) => {
        const active = presetMatches(preset, filters);
        return (
          <button
            type="button"
            key={preset.id}
            data-testid={`preset-${preset.id}`}
            onClick={() => onSelect(preset)}
            style={{
              height: 24,
              padding: "0 8px",
              fontSize: 11,
              fontFamily: "var(--cl-font-mono)",
              color: active ? "var(--cl-text-primary)" : "var(--cl-text-secondary)",
              background: active ? "var(--cl-bg-04)" : "transparent",
              border: `1px solid ${active ? "var(--cl-accent-ring)" : "var(--cl-border-subtle)"}`,
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
