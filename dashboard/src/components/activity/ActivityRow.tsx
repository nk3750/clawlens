import { deriveTags, entryIcon, relTimeCompact, riskColorRaw } from "../../lib/utils";
import { describeEntry } from "../../lib/groupEntries";
import type { EntryResponse } from "../../lib/types";
import GradientAvatar from "../GradientAvatar";
import DecisionBadge from "../DecisionBadge";

interface Props {
  entry: EntryResponse;
  isNew: boolean;
  /** Fired when the operator clicks an inline filter chip (agent or tier). */
  onChip: (key: "agent" | "tier", value: string) => void;
  /** Last row of its hour group has no bottom border. */
  isLastInGroup?: boolean;
}

/**
 * One row in the hour-grouped feed. Displays:
 *
 *   avatar | catIcon | agent-chip | verb-tool text | tags | tier-badge | decision-pill | rel-time
 *
 * The tier-color left border (boxShadow inset 2px 0 0 0) only paints for
 * medium/high/critical — low rows get no border, and rows lacking a tier
 * (post-#33: no decision + no LLM eval) also get no border + no badge.
 *
 * 2.1 click-to-expand is NOT wired (Phase 2.2 territory). The button shell
 * stays so keyboard users still reach the row, but onClick is a no-op.
 */
export default function ActivityRow({ entry, isNew, onChip, isLastInGroup }: Props) {
  const tier = entry.riskTier;
  const tierColor = tier ? riskColorRaw(tier) : undefined;
  const icon = entryIcon(entry);
  const tags = deriveTags(entry);
  const showDecision = entry.effectiveDecision && entry.effectiveDecision !== "allow";

  const leftBorder =
    tier && tier !== "low" && tierColor
      ? `inset 2px 0 0 0 ${tierColor}${tier === "critical" ? "" : "b3"}`
      : undefined;

  const animation = isNew
    ? "row-slide 280ms var(--cl-ease) both, row-flash 1.6s var(--cl-ease) both"
    : undefined;

  return (
    <div
      data-testid="activity-row-root"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderBottom: isLastInGroup ? "none" : "1px solid var(--cl-border-subtle)",
        background: isNew
          ? "color-mix(in srgb, var(--cl-accent) 12%, transparent)"
          : "var(--cl-bg-02)",
        boxShadow: leftBorder,
        minHeight: 36,
        animation,
        transition: "background 80ms var(--cl-ease)",
        minWidth: 0,
      }}
    >
      {/* Avatar */}
      {entry.agentId && (
        <span data-testid="activity-row-avatar" style={{ flexShrink: 0 }}>
          <GradientAvatar agentId={entry.agentId} size="xs" />
        </span>
      )}

      {/* Category / exec sub-category icon */}
      <svg
        data-testid="activity-row-cat-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={icon.color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      >
        <path d={icon.path} />
      </svg>

      {/* Agent chip — clickable filter shortcut */}
      {entry.agentId && (
        <button
          type="button"
          data-testid="activity-row-agent-chip"
          onClick={(e) => {
            e.stopPropagation();
            if (entry.agentId) onChip("agent", entry.agentId);
          }}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "0 4px",
            fontSize: 12,
            fontWeight: 590,
            color: "var(--cl-text-primary)",
            flexShrink: 0,
          }}
        >
          {entry.agentId}
        </button>
      )}

      {/* Verb + tool text */}
      <span
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--cl-text-secondary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flex: 1,
          minWidth: 0,
        }}
      >
        {describeEntry(entry)}
      </span>

      {/* Inline tags (max 2) */}
      {tags.slice(0, 2).map((tag) => (
        <span
          key={tag}
          data-testid={`activity-row-tag-${tag}`}
          className="mono"
          style={{
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: "0.05em",
            color: "var(--cl-text-muted)",
            padding: "2px 5px",
            borderRadius: 2,
            border: "1px solid var(--cl-border-subtle)",
            background: "var(--cl-bg-02)",
            flexShrink: 0,
          }}
        >
          {tag.toUpperCase()}
        </span>
      ))}

      {/* Tier badge — clickable filter shortcut. Skipped when no tier. */}
      {tier && tierColor && entry.riskScore != null && (
        <button
          type="button"
          data-testid="activity-row-tier-badge"
          onClick={(e) => {
            e.stopPropagation();
            onChip("tier", tier);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: tierColor,
              boxShadow: tier !== "low" ? `0 0 4px ${tierColor}90` : undefined,
            }}
          />
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--cl-text-secondary)",
              fontFeatureSettings: '"tnum"',
            }}
          >
            {entry.riskScore}
          </span>
          <span
            className="mono"
            style={{ fontSize: 9, color: tierColor, letterSpacing: "0.06em", fontWeight: 500 }}
          >
            {tier.toUpperCase()}
          </span>
        </button>
      )}

      {/* Decision pill */}
      {showDecision && (
        <span data-testid="activity-row-decision" style={{ flexShrink: 0 }}>
          <DecisionBadge decision={entry.effectiveDecision} />
        </span>
      )}

      {/* Rel-time */}
      <span
        data-testid="activity-row-time"
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--cl-text-muted)",
          minWidth: 32,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {relTimeCompact(entry.timestamp)}
      </span>

    </div>
  );
}
