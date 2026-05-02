import { useState } from "react";
import { createPortal } from "react-dom";
import type { EntryResponse, GuardrailAction, Target } from "../lib/types";
import { riskColorRaw, riskTierFromScore } from "../lib/utils";
import PatternModeToggle from "./guardrails/PatternModeToggle";
import {
  ACTION_META,
  type ResourceKind,
  resourceKindFromToolName,
  suggestGlobs,
  targetKindFor,
  VERB_LIBRARY,
} from "./guardrails/shared";
import UpgradeBanner from "./guardrails/UpgradeBanner";
import VerbChip from "./guardrails/VerbChip";

interface Props {
  entry: EntryResponse;
  description: string;
  onClose: () => void;
  /**
   * Fired after a successful POST. `result.existing` is true when the
   * backend recognized an equivalent (selector, target) rule and returned
   * the original unchanged (idempotency). Callers that don't care about
   * the distinction can declare `() => void` — TS allows fewer-arg handlers.
   */
  onCreated: (result: { existing: boolean }) => void;
}

const BASE = "/plugins/clawlens";

export default function GuardrailModal({ entry, description, onClose, onCreated }: Props) {
  const resourceKind: ResourceKind = resourceKindFromToolName(entry.toolName);

  const [verbs, setVerbs] = useState<string[]>([entry.toolName]);
  const [patternMode, setPatternMode] = useState<"exact" | "glob">("exact");
  const [pattern, setPattern] = useState<string>(entry.identityKey ?? "");
  const [dirtyPattern, setDirtyPattern] = useState(false);
  const [action, setAction] = useState<GuardrailAction>("block");
  const [scope, setScope] = useState<"agent" | "global">("agent");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : null;
  const tierColor = tier ? riskColorRaw(tier) : null;

  const isAdvanced = resourceKind === "advanced";
  const upgraded = !isAdvanced && (verbs.length > 1 || patternMode === "glob");
  const upgradeReason =
    patternMode === "glob"
      ? "Broader pattern."
      : "Multi-verb means this rule needs a resource pattern, not an identity key.";

  const toggleVerb = (verb: string) => {
    setVerbs((prev) => {
      if (prev.includes(verb)) {
        // Floor of 1: backend rejects empty arrays; never let UI emit [].
        if (prev.length === 1) return prev;
        return prev.filter((v) => v !== verb);
      }
      return [...prev, verb];
    });
  };

  const handleModeToggle = (mode: "exact" | "glob") => {
    if (isAdvanced) return;
    setPatternMode(mode);
    if (dirtyPattern) return;
    if (mode === "glob") {
      const sug = suggestGlobs(resourceKind, entry.identityKey ?? "");
      if (sug[0]) setPattern(sug[0]);
    } else {
      setPattern(entry.identityKey ?? "");
    }
  };

  const handlePatternChange = (value: string) => {
    setPattern(value);
    setDirtyPattern(true);
  };

  const buildTarget = (): Target => {
    if (isAdvanced || (verbs.length === 1 && patternMode === "exact")) {
      return { kind: "identity-glob", pattern };
    }
    return { kind: targetKindFor(resourceKind), pattern };
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/guardrails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selector: {
            agent: scope === "global" ? null : (entry.agentId ?? null),
            tools: { mode: "names", values: verbs },
          },
          target: buildTarget(),
          action,
          source: {
            toolCallId: entry.toolCallId,
            sessionKey: entry.sessionKey ?? "",
            agentId: entry.agentId ?? "",
          },
          riskScore: entry.riskScore ?? 0,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error || `HTTP ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as { existing?: boolean };
      onCreated({ existing: body.existing === true });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create guardrail");
    } finally {
      setSaving(false);
    }
  };

  const submitDisabled = saving || pattern.trim().length === 0;
  const patternHint = isAdvanced
    ? "MCP / unknown tool — pattern editing disabled."
    : patternMode === "glob"
      ? "Glob: * matches a segment, ** matches any depth."
      : "Exact identity match — only the literal call repeats.";

  // §13.1: portal to document.body so the modal escapes ancestor stacking
  // contexts. Mirrors SwarmPopover.tsx:60 / DateChip.tsx:189.
  return createPortal(
    <div
      data-testid="guardrail-modal"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: "rgba(0,0,0,0.6)",
        animation: "var(--cl-spring-duration) var(--cl-spring) both cl-fade-in",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="guardrail-modal-panel"
        className="rounded-xl p-6 w-full max-w-md"
        style={{
          backgroundColor: "var(--cl-surface)",
          border: "1px solid var(--cl-border)",
          animation: "var(--cl-spring-duration) var(--cl-spring) both cl-modal-in",
        }}
      >
        {/* Header */}
        <header className="flex items-start gap-3 mb-4">
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "var(--cl-r-md)",
              backgroundColor: "var(--cl-accent-tint)",
              border: "1px solid var(--cl-accent-ring)",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--cl-accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <title>Add guardrail</title>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2
              data-testid="modal-title"
              className="text-base font-semibold"
              style={{ color: "var(--cl-text-primary)" }}
            >
              Add guardrail
            </h2>
            <p
              className="text-xs mt-0.5"
              style={{ color: "var(--cl-text-muted)" }}
            >
              One rule covers a resource across the verbs you pick.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 p-1 rounded-md"
            style={{
              background: "transparent",
              color: "var(--cl-text-muted)",
              cursor: "pointer",
              border: "none",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <title>Close</title>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Source context */}
        <div
          className="rounded-lg p-3 mb-4"
          style={{ backgroundColor: "var(--cl-elevated)" }}
        >
          <p
            className="text-sm mb-1"
            style={{
              color: "var(--cl-text-primary)",
              wordBreak: "break-all",
            }}
          >
            {description}
          </p>
          <div
            className="flex items-center gap-3 text-xs flex-wrap mt-1"
            style={{ color: "var(--cl-text-muted)" }}
          >
            {entry.riskScore != null && tier && tierColor && (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: tierColor }}
                />
                <span style={{ fontFamily: "var(--cl-font-mono)" }}>{entry.riskScore}</span>
                <span style={{ color: tierColor, textTransform: "uppercase" }}>{tier}</span>
              </span>
            )}
            {entry.agentId && <span>{entry.agentId}</span>}
            {entry.toolCallId && (
              <span style={{ fontFamily: "var(--cl-font-mono)" }}>{entry.toolCallId}</span>
            )}
          </div>
        </div>

        {/* Covered verbs */}
        <SectionLabel hint={isAdvanced ? undefined : "tap to add coverage"}>
          covered verbs
        </SectionLabel>
        <div data-testid="verb-row" className="flex flex-wrap items-center gap-1.5 mb-4">
          {isAdvanced ? (
            <>
              <VerbChip verb={entry.toolName} on={true} disabled={true} />
              <span
                className="text-[10px]"
                style={{
                  fontFamily: "var(--cl-font-mono)",
                  letterSpacing: "0.06em",
                  color: "var(--cl-text-muted)",
                  textTransform: "uppercase",
                }}
              >
                advanced
              </span>
            </>
          ) : (
            VERB_LIBRARY[resourceKind].map((v) => (
              <VerbChip
                key={v}
                verb={v}
                on={verbs.includes(v)}
                onClick={() => toggleVerb(v)}
              />
            ))
          )}
        </div>

        {/* Match */}
        <SectionLabel>match</SectionLabel>
        <div className="mb-2">
          <PatternModeToggle
            mode={patternMode}
            onChange={handleModeToggle}
            disabled={isAdvanced}
          />
        </div>
        <input
          type="text"
          data-testid="pattern-input"
          value={pattern}
          onChange={(e) => handlePatternChange(e.target.value)}
          disabled={isAdvanced}
          className="w-full px-2 py-1.5 rounded-md text-sm mt-2"
          style={{
            fontFamily: "var(--cl-font-mono)",
            backgroundColor: "var(--cl-elevated)",
            border: "1px solid var(--cl-border-subtle)",
            color: isAdvanced ? "var(--cl-text-muted)" : "var(--cl-text-primary)",
            opacity: isAdvanced ? 0.6 : 1,
          }}
        />
        <p
          className="text-[11px] mt-1"
          style={{ color: "var(--cl-text-muted)" }}
        >
          {patternHint}
        </p>

        {/* Upgrade banner */}
        {upgraded && (
          <div className="mt-3">
            <UpgradeBanner
              from="identity-glob"
              to={targetKindFor(resourceKind as Exclude<ResourceKind, "advanced">)}
              reason={upgradeReason}
            />
          </div>
        )}

        {/* Action */}
        <div className="mt-5">
          <SectionLabel>action</SectionLabel>
          <div className="space-y-1.5">
            {(["block", "require_approval", "allow_notify"] as const).map((a) => {
              const am = ACTION_META[a];
              const active = action === a;
              return (
                <button
                  key={a}
                  type="button"
                  data-testid={`action-row-${a}`}
                  onClick={() => setAction(a)}
                  className="w-full flex items-start gap-2 px-3 py-2 rounded-md text-left transition-colors"
                  style={{
                    border: `1px solid ${active ? am.color : "var(--cl-border-subtle)"}`,
                    backgroundColor: active ? "var(--cl-bg-05)" : "transparent",
                    color: "var(--cl-text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <span
                    aria-hidden
                    className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0"
                    style={{ backgroundColor: am.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm" style={{ color: "var(--cl-text-primary)" }}>
                      {am.label}
                    </div>
                    <div
                      className="text-[11px] mt-0.5"
                      style={{ color: "var(--cl-text-muted)" }}
                    >
                      {am.blurb}
                    </div>
                  </div>
                  {active && (
                    <span aria-hidden className="shrink-0" style={{ color: am.color }}>
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scope */}
        <div className="mt-5">
          <SectionLabel>scope</SectionLabel>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "1fr 1fr",
              padding: "3px",
              backgroundColor: "var(--cl-bg-02)",
              border: "1px solid var(--cl-border)",
              borderRadius: "var(--cl-r-md)",
            }}
          >
            <ScopeButton
              testId="scope-this-agent"
              title="this agent"
              sub={entry.agentId ?? ""}
              active={scope === "agent"}
              onClick={() => setScope("agent")}
            />
            <ScopeButton
              testId="scope-all-agents"
              title="all agents"
              sub=""
              active={scope === "global"}
              onClick={() => setScope("global")}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <p
            className="text-xs mt-3"
            style={{ color: "var(--cl-risk-high)" }}
            role="alert"
          >
            {error}
          </p>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg transition-colors"
            style={{
              color: "var(--cl-text-secondary)",
              backgroundColor: "var(--cl-elevated)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="px-4 py-2 text-sm rounded-lg font-medium transition-colors"
            style={{
              backgroundColor: "var(--cl-accent)",
              color: "var(--cl-bg)",
              border: "none",
              cursor: submitDisabled ? "default" : "pointer",
              opacity: submitDisabled ? 0.6 : 1,
            }}
          >
            {saving ? "Adding..." : "Add guardrail"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SectionLabel({
  children,
  hint,
}: {
  children: string;
  hint?: string;
}) {
  return (
    <div
      className="flex items-baseline gap-2 mb-2"
      style={{ color: "var(--cl-text-muted)" }}
    >
      <span
        className="text-[10px]"
        style={{
          fontFamily: "var(--cl-font-mono)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {children}
      </span>
      {hint && <span className="text-[11px]">{hint}</span>}
    </div>
  );
}

function ScopeButton({
  testId,
  title,
  sub,
  active,
  onClick,
}: {
  testId: string;
  title: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? "true" : "false"}
      onClick={onClick}
      className="flex flex-col items-start px-3 py-1.5 rounded-md transition-colors"
      style={{
        backgroundColor: active ? "var(--cl-bg-05)" : "transparent",
        color: active ? "var(--cl-text-primary)" : "var(--cl-text-muted)",
        cursor: "pointer",
        transition: "background var(--cl-dur-fast) var(--cl-ease)",
        border: "none",
      }}
    >
      <span className="text-sm" style={{ color: "inherit" }}>
        {title}
      </span>
      {sub && (
        <span
          className="text-[10px]"
          style={{
            fontFamily: "var(--cl-font-mono)",
            letterSpacing: "0.06em",
            color: "var(--cl-text-muted)",
          }}
        >
          {sub}
        </span>
      )}
    </button>
  );
}
