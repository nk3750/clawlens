import { useEffect, useRef } from "react";
import { RANGE_OPTIONS, type RangeOption } from "./utils";

interface Props {
  value: RangeOption;
  onChange: (next: RangeOption) => void;
}

/**
 * Six-pill range selector. role="radiogroup" with arrow-key navigation per
 * spec §12. The active pill takes accent bg/fg; inactive pills sit on the
 * surface tone.
 *
 * Below 720px we hide the pill grid and render a native `<select>` dropdown
 * instead (spec §3 + §11). The two variants sit side-by-side; `.cl-fh-range-*`
 * CSS rules in index.css swap them at the breakpoint. Keeping both mounted
 * means no JS resize-observer and no hydration flicker.
 */
export default function RangePillGroup({ value, onChange }: Props) {
  const refs = useRef<Record<RangeOption, HTMLButtonElement | null>>(
    {} as Record<RangeOption, HTMLButtonElement | null>,
  );

  useEffect(() => {
    // Keep DOM checked state aligned with React state for screen readers.
    for (const r of RANGE_OPTIONS) {
      const node = refs.current[r];
      if (node) node.setAttribute("aria-checked", r === value ? "true" : "false");
    }
  }, [value]);

  function focusByDelta(delta: number) {
    const idx = RANGE_OPTIONS.indexOf(value);
    const nextIdx = (idx + delta + RANGE_OPTIONS.length) % RANGE_OPTIONS.length;
    const next = RANGE_OPTIONS[nextIdx];
    onChange(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusByDelta(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusByDelta(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(RANGE_OPTIONS[0]);
      refs.current[RANGE_OPTIONS[0]]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const last = RANGE_OPTIONS[RANGE_OPTIONS.length - 1];
      onChange(last);
      refs.current[last]?.focus();
    }
  }

  return (
    <div className="cl-fh-range-group">
      <div
        role="radiogroup"
        aria-label="Time range"
        onKeyDown={onKeyDown}
        className="cl-fh-range-pills inline-flex items-center"
        style={{ gap: 2 }}
      >
        {RANGE_OPTIONS.map((r) => {
          const active = r === value;
          return (
            <button
              key={r}
              ref={(el) => {
                refs.current[r] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(r)}
              className="font-mono btn-press"
              style={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: "var(--cl-radius-sm, 6px)",
                border: "1px solid",
                borderColor: active ? "var(--cl-accent)" : "transparent",
                cursor: "pointer",
                background: active ? "var(--cl-accent)" : "transparent",
                color: active ? "var(--cl-bg)" : "var(--cl-text-muted)",
                fontWeight: active ? 700 : 500,
                transition: "background 0.15s var(--cl-ease), color 0.15s var(--cl-ease)",
                minWidth: 36,
                textAlign: "center",
                letterSpacing: "0.04em",
              }}
            >
              {r}
            </button>
          );
        })}
      </div>

      {/* Narrow-mode dropdown — CSS shows this below 720px and hides the pills. */}
      <label className="cl-fh-range-select-wrap" style={{ position: "relative" }}>
        <span
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          Time range
        </span>
        <select
          aria-label="Time range"
          value={value}
          onChange={(e) => onChange(e.target.value as RangeOption)}
          className="cl-fh-range-select font-mono"
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            padding: "4px 26px 4px 10px",
            borderRadius: "var(--cl-radius-sm, 6px)",
            border: "1px solid var(--cl-border-default)",
            background: "var(--cl-elevated)",
            color: "var(--cl-text-primary)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            minWidth: 80,
            letterSpacing: "0.04em",
          }}
        >
          {RANGE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            fontSize: 10,
            color: "var(--cl-text-muted)",
          }}
        >
          ▾
        </span>
      </label>
    </div>
  );
}
