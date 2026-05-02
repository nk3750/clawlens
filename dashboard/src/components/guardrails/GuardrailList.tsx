import type { Guardrail } from "../../lib/types";
import GuardrailListRow from "./GuardrailListRow";

interface Props {
  rules: Guardrail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Whether the unfiltered set is non-empty — distinguishes "no matches"
   *  from "no rules at all" in the empty-state copy. */
  hasAnyRules: boolean;
}

export default function GuardrailList({ rules, selectedId, onSelect, hasAnyRules }: Props) {
  return (
    <div
      className="shrink-0 overflow-y-auto"
      style={{
        width: 360,
        borderRight: "1px solid var(--cl-border-subtle)",
        backgroundColor: "var(--cl-bg)",
      }}
    >
      <div
        className="px-4 py-3 sticky top-0 z-10"
        style={{
          borderBottom: "1px solid var(--cl-border-subtle)",
          backgroundColor: "var(--cl-bg)",
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--cl-text-primary)" }}>
            Guardrails
          </h2>
          <span
            className="text-xs"
            style={{ fontFamily: "var(--cl-font-mono)", color: "var(--cl-text-muted)" }}
          >
            {rules.length}
          </span>
        </div>
      </div>
      {rules.length === 0 ? (
        <p className="px-4 py-6 text-sm text-center" style={{ color: "var(--cl-text-muted)" }}>
          {hasAnyRules
            ? "No guardrails match the current filters."
            : "No guardrails yet. Add one from any entry in the Activity or Agent views."}
        </p>
      ) : (
        <div role="list">
          {rules.map((r) => (
            <GuardrailListRow
              key={r.id}
              rule={r}
              selected={selectedId === r.id}
              onSelect={() => onSelect(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
