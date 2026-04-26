import type { KeyboardEvent, MouseEvent, SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
import { riskTagSentence } from "../../lib/utils";
import type { EntryResponse } from "../../lib/types";
import { toolString } from "./RowQuickActions";

interface Props {
  entry: EntryResponse;
}

/**
 * Expanded body that renders directly below an activity row when the user
 * clicks to expand. Two columns: risk reasoning on the left (score, tier,
 * tag-derived sentence, static-vs-LLM contribution split) and raw command
 * + identifiers on the right. Three action buttons sit below the columns.
 *
 * All interactive controls stop event propagation so clicks don't toggle
 * the parent row's expanded state.
 */
export default function ActivityRowExpanded({ entry }: Props) {
  const navigate = useNavigate();
  const sessionKey = entry.sessionKey;
  const command = toolString(entry);

  // React suppresses onClick on disabled <button>s; the surrounding panel
  // catches anything that bubbles up so disabled clicks never reach the row.
  const stopAny = (e: SyntheticEvent) => e.stopPropagation();
  const stopBtn = (e: MouseEvent<HTMLButtonElement>) => e.stopPropagation();

  const handleCopy = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(command);
  };

  const handleOpenSession = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (sessionKey) navigate(`/session/${encodeURIComponent(sessionKey)}`);
  };

  return (
    <div
      data-testid="activity-row-expanded"
      onClick={stopAny}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => stopAny(e)}
      style={{
        padding: "14px 18px 16px 50px",
        background: "var(--cl-bg-03)",
        borderTop: "1px solid var(--cl-border-subtle)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Reasoning entry={entry} />
        <Raw entry={entry} command={command} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          type="button"
          data-testid="activity-row-expanded-add-guardrail"
          className="cl-btn cl-btn-primary"
          disabled
          title="not yet implemented"
          onClick={stopBtn}
          style={{ height: 26, fontSize: 12, cursor: "not-allowed" }}
        >
          add guardrail
        </button>
        <button
          type="button"
          data-testid="activity-row-expanded-open-session"
          className="cl-btn"
          disabled={!sessionKey}
          title={sessionKey ? "open session" : "no session"}
          onClick={handleOpenSession}
          style={{ height: 26, fontSize: 12 }}
        >
          open session
        </button>
        <button
          type="button"
          data-testid="activity-row-expanded-copy"
          className="cl-btn cl-btn-subtle"
          onClick={handleCopy}
          style={{ height: 26, fontSize: 12 }}
        >
          copy
        </button>
      </div>
    </div>
  );
}

function Reasoning({ entry }: { entry: EntryResponse }) {
  const tier = entry.riskTier;
  const tierLabel = tier ? tier.toUpperCase() : null;
  const score = entry.riskScore;

  // Dedupe sentence text — `credential-abuse` and `ssh-key-usage` map to the
  // same sentence; we don't want to print "Credential surface accessed."
  // twice on a single entry.
  const seen = new Set<string>();
  const sentences: string[] = [];
  for (const tag of entry.riskTags ?? []) {
    const sent = riskTagSentence(tag);
    if (sent && !seen.has(sent)) {
      seen.add(sent);
      sentences.push(sent);
    }
  }
  const tagSentence = sentences.join(" ");

  // Static-vs-LLM split: only render when both pieces are present (defensive
  // — types.ts says originalRiskScore is only set when llmEvaluation exists).
  const hasSplit = entry.llmEvaluation != null && entry.originalRiskScore != null;
  const llmContribution = hasSplit
    ? Math.max(
        0,
        (entry.riskScore ?? entry.llmEvaluation?.adjustedScore ?? 0) -
          (entry.originalRiskScore ?? 0),
      )
    : null;

  return (
    <DetailBlock label="risk reasoning">
      <div
        data-testid="activity-row-reasoning"
        style={{ color: "var(--cl-text-secondary)", lineHeight: 1.6 }}
      >
        {score != null && tierLabel ? (
          <>
            Score{" "}
            <span className="mono" style={{ color: "var(--cl-text-primary)" }}>
              {score}
            </span>{" "}
            · {tierLabel} tier.{" "}
          </>
        ) : null}
        {tagSentence ? `${tagSentence} ` : ""}
        {hasSplit ? (
          <>
            Static rules contributed{" "}
            <span className="mono" style={{ color: "var(--cl-text-primary)" }}>
              {entry.originalRiskScore}
            </span>
            , LLM classifier contributed{" "}
            <span className="mono" style={{ color: "var(--cl-text-primary)" }}>
              {llmContribution}
            </span>
            .
          </>
        ) : null}
      </div>
    </DetailBlock>
  );
}

function Raw({ entry, command }: { entry: EntryResponse; command: string }) {
  return (
    <DetailBlock label="raw">
      <div
        data-testid="activity-row-raw"
        className="mono"
        style={{
          background: "var(--cl-bg-02)",
          border: "1px solid var(--cl-border-subtle)",
          borderRadius: 4,
          padding: "8px 10px",
          color: "var(--cl-text-secondary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontSize: 11,
        }}
      >
        $ {command}
      </div>
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 8,
          fontSize: 11,
          color: "var(--cl-text-muted)",
          flexWrap: "wrap",
        }}
      >
        {entry.sessionKey ? (
          <span>
            <span style={{ color: "var(--cl-text-muted)" }}>session</span>{" "}
            <span className="mono" style={{ color: "var(--cl-text-secondary)" }}>
              {entry.sessionKey}
            </span>
          </span>
        ) : null}
        {entry.toolCallId ? (
          <span>
            <span style={{ color: "var(--cl-text-muted)" }}>id</span>{" "}
            <span className="mono" style={{ color: "var(--cl-text-secondary)" }}>
              {entry.toolCallId}
            </span>
          </span>
        ) : null}
      </div>
    </DetailBlock>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="label-mono"
        style={{
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: "0.06em",
          color: "var(--cl-text-muted)",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
