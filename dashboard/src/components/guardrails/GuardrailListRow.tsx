import type { Guardrail } from "../../lib/types";
import { relTime, riskColorRaw, riskTierFromScore } from "../../lib/utils";
import { ACTION_META, resourceKindFromTarget, shortPath } from "./shared";

interface Props {
  rule: Guardrail;
  selected: boolean;
  onSelect: () => void;
}

function verbsLabel(rule: Guardrail): string {
  const tools = rule.selector.tools;
  switch (tools.mode) {
    case "any":
      return "ANY TOOL";
    case "category":
      return tools.value.toUpperCase();
    case "names":
      return tools.values.map((v) => v.toUpperCase()).join("+");
  }
}

export default function GuardrailListRow({ rule, selected, onSelect }: Props) {
  const meta = ACTION_META[rule.action];
  const tier = riskTierFromScore(rule.riskScore);
  const tierColor = riskColorRaw(tier);
  const kind = resourceKindFromTarget(rule.target);
  const resource = shortPath(rule.target.pattern, 36);
  const useMono = kind === "file" || kind === "exec" || kind === "advanced";
  const isIdentity = kind === "advanced";
  const hits24h = rule.hits24h ?? 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`guardrail-row-${rule.id}`}
      data-active={selected ? "true" : "false"}
      className="w-full text-left px-4 py-2.5 transition-colors"
      style={{
        backgroundColor: selected ? "var(--cl-bg-05)" : "transparent",
        borderLeft: selected ? `2px solid ${meta.color}` : "2px solid transparent",
        borderBottom: "1px solid var(--cl-border-subtle)",
        cursor: "pointer",
      }}
    >
      <div className="flex items-center gap-2">
        <Shield color={meta.color} />
        <span
          className="flex-1 min-w-0 truncate text-[13px]"
          style={{
            fontFamily: useMono ? "var(--cl-font-mono)" : "var(--cl-font-sans)",
            color: "var(--cl-text-primary)",
          }}
        >
          {resource}
        </span>
        {rule.riskScore > 0 && (
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: tierColor }}
          />
        )}
      </div>
      <div className="flex items-center justify-between mt-1 pl-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-[10px] shrink-0"
            style={{
              fontFamily: "var(--cl-font-mono)",
              letterSpacing: "0.06em",
              color: meta.color,
            }}
          >
            {meta.mono}
          </span>
          {!isIdentity && (
            <span
              className="text-[10px] truncate"
              style={{
                fontFamily: "var(--cl-font-mono)",
                letterSpacing: "0.06em",
                color: "var(--cl-text-secondary)",
              }}
            >
              {verbsLabel(rule)}
            </span>
          )}
        </div>
        <span className="text-[10px] shrink-0" style={{ color: "var(--cl-text-muted)" }}>
          {hits24h > 0 && rule.lastFiredAt
            ? `${hits24h} hits · ${relTime(rule.lastFiredAt)}`
            : "no hits yet"}
        </span>
      </div>
    </button>
  );
}

function Shield({ color }: { color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <title>Guardrail shield</title>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
