import type { AgentInfo, ActivityCategory, RiskTier } from "../lib/types";
import { CATEGORY_META } from "../lib/utils";

export interface FilterState {
  agent: string;
  category: string;
  riskTier: string;
  decision: string;
  since: string;
}

interface Props {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  agents?: AgentInfo[];
}

const CATEGORY_ORDER: ActivityCategory[] = [
  "exploring",
  "changes",
  "git",
  "scripts",
  "web",
  "comms",
];
const CATEGORIES: { value: ActivityCategory; label: string }[] = CATEGORY_ORDER.map(
  (value) => ({ value, label: CATEGORY_META[value].label }),
);

const RISK_TIERS: { value: RiskTier; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const DECISIONS = [
  { value: "allow", label: "Allowed" },
  { value: "block", label: "Blocked" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "pending", label: "Pending" },
  { value: "timeout", label: "Timeout" },
];

const TIME_RANGES = [
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6h" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "", label: "All time" },
];

const selectStyle: React.CSSProperties = {
  backgroundColor: "var(--cl-surface)",
  borderColor: "var(--cl-border-default)",
  color: "var(--cl-text-primary)",
};

const selectClass =
  "rounded-lg border px-3 py-2 text-sm font-mono outline-none transition-all focus:ring-2 focus:ring-offset-0 appearance-none cursor-pointer";

export default function FilterBar({ filters, onChange, agents }: Props) {
  const update = (key: keyof FilterState, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div
      className="flex flex-wrap items-center rounded-xl p-3"
      style={{
        gap: "clamp(8px, 1.5vw, 16px)",
        backgroundColor: "var(--cl-surface)",
        border: "1px solid var(--cl-border-subtle)",
      }}
    >
      {/* Agent */}
      <select
        value={filters.agent}
        onChange={(e) => update("agent", e.target.value)}
        className={selectClass}
        style={selectStyle}
      >
        <option value="">All agents</option>
        {agents?.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      {/* Category */}
      <select
        value={filters.category}
        onChange={(e) => update("category", e.target.value)}
        className={selectClass}
        style={selectStyle}
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>

      {/* Risk tier */}
      <select
        value={filters.riskTier}
        onChange={(e) => update("riskTier", e.target.value)}
        className={selectClass}
        style={selectStyle}
      >
        <option value="">All risk</option>
        {RISK_TIERS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      {/* Decision */}
      <select
        value={filters.decision}
        onChange={(e) => update("decision", e.target.value)}
        className={selectClass}
        style={selectStyle}
      >
        <option value="">All decisions</option>
        {DECISIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>

      {/* Time range */}
      <select
        value={filters.since}
        onChange={(e) => update("since", e.target.value)}
        className={selectClass}
        style={selectStyle}
      >
        {TIME_RANGES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Clear all — only show if any filter active */}
      {(filters.agent || filters.category || filters.riskTier || filters.decision || filters.since) && (
        <button
          onClick={() =>
            onChange({ agent: "", category: "", riskTier: "", decision: "", since: "" })
          }
          className="label-mono px-2 py-1 rounded transition-colors"
          style={{ color: "var(--cl-accent)" }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
