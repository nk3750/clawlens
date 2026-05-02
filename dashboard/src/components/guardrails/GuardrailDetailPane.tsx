import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../hooks/useApi";
import type { Guardrail, GuardrailAction } from "../../lib/types";
import { relTime, riskColorRaw, riskTierFromScore } from "../../lib/utils";
import Sparkline from "./Sparkline";
import {
  ACTION_META,
  resourceKindFromTarget,
  type ResourceKind,
  VERB_LIBRARY,
} from "./shared";
import VerbChip from "./VerbChip";

export interface PatchBody {
  action?: GuardrailAction;
  note?: string;
  agent?: string | null;
  tools?: { values: string[] };
  target?: { pattern: string };
}

interface Props {
  rule: Guardrail;
  /** Returns the PATCH promise so input handlers can revert on error. */
  onPatch: (patch: PatchBody) => Promise<void>;
  /** Returns the DELETE promise so the orchestrator can clear selectedId. */
  onDelete: () => Promise<void>;
}

interface Firing {
  at: string;
  toolName: string;
  agentId: string;
  sessionKey?: string;
  resolution: "approved" | "denied" | "pending" | "allow_notify";
}

interface StatsResponse {
  id: string;
  hits24h: number;
  lastFiredAt: string | null;
  sparkline: number[];
}

const VERB_DISABLED_HINT_IDENTITY =
  "Identity rules cover a single tool — recreate from Activity to change.";
const VERB_DISABLED_HINT_MODE = "Verb editing is only available for names-mode rules.";
const PATTERN_DISABLED_HINT_IDENTITY =
  "Identity-glob patterns are exact-match identity keys. Recreate from a fresh Activity row to change.";

export default function GuardrailDetailPane({ rule, onPatch, onDelete }: Props) {
  const meta = ACTION_META[rule.action];
  const tier = riskTierFromScore(rule.riskScore);
  const tierColor = riskColorRaw(tier);
  const kind = resourceKindFromTarget(rule.target);
  const useMono = kind === "file" || kind === "exec" || kind === "advanced";

  const verbsDisabled = kind === "advanced" || rule.selector.tools.mode !== "names";
  const verbsHint =
    kind === "advanced"
      ? VERB_DISABLED_HINT_IDENTITY
      : rule.selector.tools.mode !== "names"
        ? VERB_DISABLED_HINT_MODE
        : undefined;
  const patternDisabled = kind === "advanced";
  const patternHint = kind === "advanced" ? PATTERN_DISABLED_HINT_IDENTITY : undefined;

  const verbLibrary = kind === "advanced" ? [] : VERB_LIBRARY[kind as Exclude<ResourceKind, "advanced">];
  const activeVerbs =
    rule.selector.tools.mode === "names" ? new Set(rule.selector.tools.values) : new Set<string>();

  const [pattern, setPattern] = useState(rule.target.pattern);
  const [note, setNote] = useState(rule.note ?? "");
  const [error, setError] = useState<string | null>(null);
  // Reset local input state when the operator selects a different rule. We
  // intentionally key on rule.id only — refetch-driven changes to pattern/note
  // shouldn't clobber an in-flight typing session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rule.id is the
  // intentional reset trigger; pattern/note from rule are the new baseline.
  useEffect(() => {
    setPattern(rule.target.pattern);
    setNote(rule.note ?? "");
    setError(null);
  }, [rule.id]);

  const stats = useApi<StatsResponse>(`api/guardrails/${rule.id}/stats`);
  const firingsApi = useApi<{ firings: Firing[] }>(`api/guardrails/${rule.id}/firings?limit=10`);
  const sparkValues = stats.data?.sparkline ?? [];
  const firings = firingsApi.data?.firings ?? [];

  async function fire(patch: PatchBody, onError?: () => void) {
    setError(null);
    try {
      await onPatch(patch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "PATCH failed";
      setError(msg);
      onError?.();
    }
  }

  const handleVerbToggle = (verb: string) => {
    if (verbsDisabled) return;
    const next = new Set(activeVerbs);
    if (next.has(verb)) next.delete(verb);
    else next.add(verb);
    if (next.size === 0) {
      // A names-mode rule must have ≥1 verb (backend rejects empty arrays).
      // Don't fire the PATCH; show error instead.
      setError("A rule must cover at least one verb.");
      return;
    }
    fire({ tools: { values: Array.from(next) } });
  };

  const handleActionClick = (next: GuardrailAction) => {
    if (next === rule.action) return;
    fire({ action: next });
  };

  const handleScopeThisAgent = () => {
    const resolved = rule.selector.agent ?? rule.source.agentId;
    fire({ agent: resolved });
  };
  const handleScopeAll = () => {
    fire({ agent: null });
  };

  const handlePatternBlur = () => {
    if (patternDisabled) return;
    if (pattern === rule.target.pattern) return;
    if (pattern.trim().length === 0) {
      setPattern(rule.target.pattern);
      setError("Pattern cannot be empty.");
      return;
    }
    fire({ target: { pattern } }, () => setPattern(rule.target.pattern));
  };

  const handleNoteBlur = () => {
    if (note === (rule.note ?? "")) return;
    fire({ note }, () => setNote(rule.note ?? ""));
  };

  const handleDeleteClick = async () => {
    if (!window.confirm("Delete this guardrail? This cannot be undone.")) return;
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="px-8 py-8 max-w-4xl">
      {/* Header */}
      <header className="flex items-start gap-3 mb-6">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke={meta.color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="shrink-0 mt-0.5"
        >
          <title>Guardrail shield</title>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <div className="flex-1 min-w-0">
          <h1
            className="text-base mb-1.5"
            style={{
              fontFamily: useMono ? "var(--cl-font-mono)" : "var(--cl-font-sans)",
              color: "var(--cl-text-primary)",
              wordBreak: "break-all",
              fontWeight: 510,
            }}
            data-testid="detail-resource"
          >
            {rule.target.pattern}
          </h1>
          <div
            className="flex items-center gap-2 flex-wrap text-xs"
            style={{ color: "var(--cl-text-muted)" }}
          >
            <span
              style={{
                fontFamily: "var(--cl-font-mono)",
                letterSpacing: "0.06em",
                color: meta.color,
              }}
            >
              {meta.mono}
            </span>
            <span aria-hidden>·</span>
            <span>{rule.selector.agent ?? "all agents"}</span>
            {rule.riskScore > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: tierColor }}
                  />
                  <span style={{ fontFamily: "var(--cl-font-mono)" }}>{rule.riskScore}</span>
                  <span style={{ color: tierColor, textTransform: "uppercase" }}>{tier}</span>
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>added {relTime(rule.createdAt)}</span>
          </div>
        </div>
      </header>

      {/* Form */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Left col */}
        <div>
          <SectionLabel>covered verbs</SectionLabel>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {verbLibrary.map((v) => (
              <VerbChip
                key={v}
                verb={v}
                on={activeVerbs.has(v)}
                onClick={() => handleVerbToggle(v)}
                disabled={verbsDisabled}
                hint={verbsHint}
              />
            ))}
            {verbsDisabled && verbsHint && (
              <span
                className="text-xs"
                style={{ color: "var(--cl-text-muted)", fontStyle: "italic" }}
                data-testid="verbs-disabled-hint"
              >
                {verbsHint}
              </span>
            )}
          </div>
          {!verbsDisabled && (
            <p className="text-xs" style={{ color: "var(--cl-text-muted)" }}>
              One rule covers all selected verbs.
            </p>
          )}

          <SectionLabel className="mt-6">action</SectionLabel>
          <div className="space-y-1.5">
            {(["block", "require_approval", "allow_notify"] as const).map((a) => {
              const am = ACTION_META[a];
              const active = rule.action === a;
              return (
                <button
                  key={a}
                  type="button"
                  data-testid={`action-${a}`}
                  onClick={() => handleActionClick(a)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
                  style={{
                    border: `1px solid ${active ? am.color : "var(--cl-border-subtle)"}`,
                    backgroundColor: active ? "var(--cl-bg-05)" : "transparent",
                    color: "var(--cl-text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <span
                    aria-hidden
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: am.color }}
                  />
                  <span className="flex-1 text-left">{am.label}</span>
                  {active && (
                    <span aria-hidden style={{ color: am.color }}>
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right col */}
        <div>
          <SectionLabel>scope</SectionLabel>
          <div className="flex gap-2 mb-6">
            <ScopeButton
              testId="scope-this-agent"
              label="this agent"
              active={rule.selector.agent !== null}
              onClick={handleScopeThisAgent}
            />
            <ScopeButton
              testId="scope-all-agents"
              label="all agents"
              active={rule.selector.agent === null}
              onClick={handleScopeAll}
            />
          </div>

          <SectionLabel>match pattern</SectionLabel>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onBlur={handlePatternBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            disabled={patternDisabled}
            title={patternHint}
            data-testid="pattern-input"
            className="w-full px-2 py-1.5 rounded-md text-sm"
            style={{
              fontFamily: "var(--cl-font-mono)",
              backgroundColor: "var(--cl-elevated)",
              border: "1px solid var(--cl-border-subtle)",
              color: patternDisabled ? "var(--cl-text-muted)" : "var(--cl-text-primary)",
              opacity: patternDisabled ? 0.6 : 1,
            }}
          />
          <p className="text-xs mt-1 mb-6" style={{ color: "var(--cl-text-muted)" }}>
            {patternHint ?? "Glob patterns: *, **"}
          </p>

          <SectionLabel>audit note</SectionLabel>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={handleNoteBlur}
            data-testid="note-textarea"
            rows={3}
            className="w-full px-2 py-1.5 rounded-md text-sm resize-none"
            style={{
              backgroundColor: "var(--cl-elevated)",
              border: "1px solid var(--cl-border-subtle)",
              color: "var(--cl-text-primary)",
            }}
          />
        </div>
      </div>

      {error && (
        <p className="text-xs mb-4" style={{ color: "var(--cl-risk-high)" }} role="alert">
          {error}
        </p>
      )}

      {/* Stats card */}
      <section
        className="rounded-lg overflow-hidden mb-6"
        style={{
          border: "1px solid var(--cl-border-subtle)",
          backgroundColor: "var(--cl-elevated)",
        }}
      >
        <div
          className="flex items-center gap-4 px-4 py-3"
          style={{ borderBottom: "1px solid var(--cl-border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-[10px]"
              style={{
                fontFamily: "var(--cl-font-mono)",
                letterSpacing: "0.08em",
                color: "var(--cl-text-muted)",
              }}
            >
              HITS · 24H
            </span>
            <span
              className="text-base"
              style={{ fontFamily: "var(--cl-font-mono)", color: "var(--cl-text-primary)" }}
            >
              {stats.data?.hits24h ?? 0}
            </span>
          </div>
          <div className="flex-shrink-0">
            <Sparkline values={sparkValues} color={meta.color} width={180} height={32} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span
              className="text-[10px]"
              style={{
                fontFamily: "var(--cl-font-mono)",
                letterSpacing: "0.08em",
                color: "var(--cl-text-muted)",
              }}
            >
              LAST FIRED
            </span>
            <span className="text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              {stats.data?.lastFiredAt ? relTime(stats.data.lastFiredAt) : "no firings yet"}
            </span>
          </div>
        </div>
        {firings.length === 0 ? (
          <p className="px-4 py-4 text-xs text-center" style={{ color: "var(--cl-text-muted)" }}>
            no hits yet
          </p>
        ) : (
          <div>
            {firings.map((f, i) => (
              <FiringRow key={`${f.at}-${i}`} firing={f} />
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          data-testid="delete-guardrail"
          onClick={handleDeleteClick}
          className="text-sm px-3 py-1.5 rounded-md transition-colors"
          style={{
            backgroundColor: "transparent",
            color: "var(--cl-risk-high)",
            cursor: "pointer",
          }}
        >
          delete guardrail
        </button>
        <Link
          to="/activity"
          data-testid="view-source-activity"
          title={`Source entry created ${relTime(rule.createdAt)} — find by timestamp.`}
          className="text-sm"
          style={{ color: "var(--cl-accent)", textDecoration: "underline" }}
        >
          view source activity →
        </Link>
      </div>
    </div>
  );
}

function SectionLabel({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={`text-[10px] mb-2 ${className}`}
      style={{
        fontFamily: "var(--cl-font-mono)",
        letterSpacing: "0.08em",
        color: "var(--cl-text-muted)",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function ScopeButton({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? "true" : "false"}
      onClick={onClick}
      className="px-3 py-1.5 rounded-md text-sm transition-colors"
      style={{
        border: `1px solid ${active ? "var(--cl-accent-ring)" : "var(--cl-border-subtle)"}`,
        backgroundColor: active ? "var(--cl-accent-tint)" : "transparent",
        color: "var(--cl-text-primary)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function FiringRow({ firing }: { firing: Firing }) {
  const color =
    firing.resolution === "denied"
      ? "var(--cl-risk-high)"
      : firing.resolution === "pending"
        ? "var(--cl-risk-medium)"
        : firing.resolution === "approved"
          ? "var(--cl-risk-low)"
          : "var(--cl-info)";
  return (
    <div
      className="flex items-center gap-3 px-4 py-1.5 text-xs"
      style={{ borderTop: "1px solid var(--cl-border-subtle)" }}
    >
      <span
        className="shrink-0"
        style={{
          fontFamily: "var(--cl-font-mono)",
          letterSpacing: "0.06em",
          color: "var(--cl-text-secondary)",
          width: 56,
          textTransform: "uppercase",
        }}
      >
        {firing.toolName}
      </span>
      <span className="shrink-0" style={{ color, textTransform: "uppercase" }}>
        {firing.resolution}
      </span>
      <span className="flex-1 truncate" style={{ color: "var(--cl-text-secondary)" }}>
        {firing.agentId}
      </span>
      <span className="shrink-0" style={{ color: "var(--cl-text-muted)" }}>
        {relTime(firing.at)}
      </span>
    </div>
  );
}
