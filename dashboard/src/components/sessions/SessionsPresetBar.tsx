import {
  presetMatches,
  PRESETS,
  type SessionFilters,
  type SessionPreset,
} from "../../lib/sessionFilters";

interface Props {
  filters: SessionFilters;
  onSelect: (preset: SessionPreset) => void;
  isCompact?: boolean;
}

/**
 * Preset chip bar (spec §5.3). Mirrors the activity-page PresetBar shape;
 * each chip replaces the filter set with the preset's filters (no merge).
 */
export default function SessionsPresetBar({ filters, onSelect, isCompact = false }: Props) {
  return (
    <div
      data-testid="sessions-preset-bar"
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
              border: `1px solid ${
                active ? "var(--cl-accent-ring)" : "var(--cl-border-subtle)"
              }`,
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
