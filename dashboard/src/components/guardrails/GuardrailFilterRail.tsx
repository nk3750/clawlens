import type { ReactNode } from "react";
import type { GuardrailAction, RiskTier } from "../../lib/types";
import type { Filters, ResourceKind } from "./shared";

interface Counts {
  agent: Record<string, number>;
  action: Record<GuardrailAction, number>;
  kind: Record<ResourceKind, number>;
  tier: Record<RiskTier, number>;
}

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  counts: Counts;
}

const ACTION_OPTIONS: { v: GuardrailAction; l: string; dot: string }[] = [
  { v: "block", l: "block", dot: "var(--cl-risk-high)" },
  { v: "require_approval", l: "require approval", dot: "var(--cl-risk-medium)" },
  { v: "allow_notify", l: "allow + notify", dot: "var(--cl-info)" },
];

const KIND_OPTIONS: { v: Exclude<ResourceKind, "advanced">; l: string }[] = [
  { v: "file", l: "file" },
  { v: "exec", l: "command" },
  { v: "url", l: "url" },
];

const TIER_OPTIONS: { v: RiskTier; l: string; dot: string }[] = [
  { v: "critical", l: "critical", dot: "var(--cl-risk-critical)" },
  { v: "high", l: "high", dot: "var(--cl-risk-high)" },
  { v: "medium", l: "medium", dot: "var(--cl-risk-medium)" },
  { v: "low", l: "low", dot: "var(--cl-risk-low)" },
];

export default function GuardrailFilterRail({ filters, setFilters, counts }: Props) {
  const agentOptions: { v: string | null; key: string; l: string; dot: string }[] = [
    { v: "global", key: "global", l: "all agents", dot: "var(--cl-text-muted)" },
    ...Object.keys(counts.agent)
      .filter((k) => k !== "global")
      .sort()
      .map((k) => ({ v: k, key: k, l: k, dot: "var(--cl-accent)" })),
  ];

  return (
    <aside
      className="shrink-0 overflow-y-auto"
      style={{
        width: 220,
        borderRight: "1px solid var(--cl-border-subtle)",
        backgroundColor: "var(--cl-panel)",
      }}
    >
      <div className="p-3">
        <input
          type="text"
          placeholder="Search…"
          aria-label="Search guardrails (decorative)"
          className="w-full px-2 py-1.5 text-sm rounded-md"
          style={{
            backgroundColor: "var(--cl-elevated)",
            border: "1px solid var(--cl-border-subtle)",
            color: "var(--cl-text-primary)",
          }}
          // Phase 2: decorative — Filters live as 4 facets totalling ~14
          // options. Real search has no signal until the option count grows.
          // Defer wiring to v3 (spec §5.4 / §12).
          onChange={() => {}}
        />
      </div>

      <Group
        label="agent"
        active={filters.agent !== undefined}
        onClear={() => setFilters({ ...filters, agent: undefined })}
        clearTestId="clear-agent"
      >
        {agentOptions.map((o) => (
          <Option
            key={o.key}
            testIdPrefix={`opt-agent-${o.key}`}
            countTestId={`count-agent-${o.key}`}
            label={o.l}
            count={counts.agent[o.key] ?? 0}
            dot={o.dot}
            active={filters.agent === o.v}
            onClick={() =>
              setFilters({ ...filters, agent: filters.agent === o.v ? undefined : o.v })
            }
          />
        ))}
      </Group>

      <Group
        label="action"
        active={filters.action !== undefined}
        onClear={() => setFilters({ ...filters, action: undefined })}
        clearTestId="clear-action"
      >
        {ACTION_OPTIONS.map((o) => (
          <Option
            key={o.v}
            testIdPrefix={`opt-action-${o.v}`}
            countTestId={`count-action-${o.v}`}
            label={o.l}
            count={counts.action[o.v]}
            dot={o.dot}
            active={filters.action === o.v}
            onClick={() =>
              setFilters({ ...filters, action: filters.action === o.v ? undefined : o.v })
            }
          />
        ))}
      </Group>

      <Group
        label="resource"
        active={filters.kind !== undefined}
        onClear={() => setFilters({ ...filters, kind: undefined })}
        clearTestId="clear-kind"
      >
        {KIND_OPTIONS.map((o) => (
          <Option
            key={o.v}
            testIdPrefix={`opt-kind-${o.v}`}
            countTestId={`count-kind-${o.v}`}
            label={o.l}
            count={counts.kind[o.v]}
            dot="var(--cl-text-muted)"
            active={filters.kind === o.v}
            onClick={() =>
              setFilters({ ...filters, kind: filters.kind === o.v ? undefined : o.v })
            }
          />
        ))}
      </Group>

      <Group
        label="risk"
        active={filters.tier !== undefined}
        onClear={() => setFilters({ ...filters, tier: undefined })}
        clearTestId="clear-tier"
      >
        {TIER_OPTIONS.map((o) => (
          <Option
            key={o.v}
            testIdPrefix={`opt-tier-${o.v}`}
            countTestId={`count-tier-${o.v}`}
            label={o.l}
            count={counts.tier[o.v]}
            dot={o.dot}
            active={filters.tier === o.v}
            onClick={() =>
              setFilters({ ...filters, tier: filters.tier === o.v ? undefined : o.v })
            }
          />
        ))}
      </Group>
    </aside>
  );
}

interface GroupProps {
  label: string;
  active: boolean;
  onClear: () => void;
  clearTestId: string;
  children: ReactNode;
}

function Group({ label, active, onClear, clearTestId, children }: GroupProps) {
  return (
    <div className="px-3 pb-3 pt-1">
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="text-[10px] uppercase"
          style={{
            fontFamily: "var(--cl-font-mono)",
            letterSpacing: "0.08em",
            color: "var(--cl-text-muted)",
          }}
        >
          {label}
        </span>
        {active && (
          <button
            type="button"
            onClick={onClear}
            data-testid={clearTestId}
            className="text-xs leading-none px-1"
            style={{ color: "var(--cl-text-muted)", cursor: "pointer" }}
            aria-label={`Clear ${label} filter`}
          >
            ×
          </button>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

interface OptionProps {
  label: string;
  count: number;
  dot: string;
  active: boolean;
  onClick: () => void;
  testIdPrefix: string;
  countTestId: string;
}

function Option({ label, count, dot, active, onClick, testIdPrefix, countTestId }: OptionProps) {
  return (
    <button
      type="button"
      data-testid={testIdPrefix}
      onClick={onClick}
      className="w-full flex items-center justify-between px-2 py-1 rounded text-sm transition-colors"
      style={{
        backgroundColor: active ? "var(--cl-accent-tint)" : "transparent",
        color: active ? "var(--cl-text-primary)" : "var(--cl-text-secondary)",
        opacity: count === 0 && !active ? 0.5 : 1,
        cursor: "pointer",
      }}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dot }}
        />
        <span className="truncate">{label}</span>
      </span>
      <span
        data-testid={countTestId}
        className="text-xs"
        style={{ fontFamily: "var(--cl-font-mono)", color: "var(--cl-text-muted)" }}
      >
        {count}
      </span>
    </button>
  );
}
