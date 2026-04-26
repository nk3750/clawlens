import { type KeyboardEvent, useState } from "react";
import { deriveTags, entryIcon, relTimeCompact, riskColorRaw } from "../../lib/utils";
import { describeEntry } from "../../lib/groupEntries";
import type { EntryResponse } from "../../lib/types";
import GradientAvatar from "../GradientAvatar";
import DecisionBadge from "../DecisionBadge";
import GuardrailModal from "../GuardrailModal";
import ActivityRowExpanded from "./ActivityRowExpanded";
import RowQuickActions from "./RowQuickActions";

interface Props {
  entry: EntryResponse;
  isNew: boolean;
  /** Fired when the operator clicks an inline filter chip (agent or tier). */
  onChip: (key: "agent" | "tier", value: string) => void;
  /** Last row of its hour group has no bottom border. */
  isLastInGroup?: boolean;
  /** Whether this row is currently the single-expanded row in its feed. */
  isExpanded?: boolean;
  /** Toggle expand/collapse for this row. ActivityFeed enforces single-at-a-time. */
  onToggleExpand?: () => void;
  /**
   * Phase 2.9 (#37) — compact viewport (<768px). Hides inline tags, swaps
   * row-click from "expand" to "tap-to-reveal", and includes the 4th expand
   * quick-action button on touch.
   */
  isCompact?: boolean;
  /**
   * Phase 2.9 (#37) — narrow viewport (<640px). Stacks the row vertically:
   * top group (avatar + cat icon + agent chip), middle (verb + tool text),
   * bottom (tier badge + decision pill + time).
   */
  isNarrow?: boolean;
  /**
   * Phase 2.9 (#37) — tap-to-reveal at compact viewport. ActivityFeed
   * coordinates a single tappedId so tapping row B untaps row A.
   */
  isTapped?: boolean;
  /** Toggle tap state. Required when `isCompact` is true. */
  onToggleTapped?: () => void;
}

/**
 * One row in the hour-grouped feed. Displays:
 *
 *   avatar | catIcon | agent-chip | verb-tool text | [hover quick-actions] | tags | tier-badge | decision-pill | rel-time
 *
 * The tier-color left border (boxShadow inset 2px 0 0 0) only paints for
 * medium/high/critical — low rows get no border, and rows lacking a tier
 * (post-#33: no decision + no LLM eval) also get no border + no badge.
 *
 * Phase 2.2 wiring (desktop):
 * - Click row root (or Enter/Space when focused) → onToggleExpand.
 * - Hover (when not expanded) → reveals RowQuickActions strip.
 * - Expanded → mounts <ActivityRowExpanded> as a sibling below the row.
 *
 * Phase 2.9 wiring (compact, <768px):
 * - Click row root → onToggleTapped (NOT onToggleExpand).
 * - Tapped → renders quick-actions strip (with 4th expand button) and a
 *   tier-info strip below the row body.
 * - Expanded reached via the 4th quick-action button.
 *
 * Phase 2.9 wiring (narrow, <640px): row root flips to flex-direction column
 * with three internal groupings instead of the horizontal flat layout.
 *
 * The root cannot be a <button> because the row contains nested buttons
 * (agent chip, tier badge, quick-actions). We use role="button" + tabIndex
 * to keep keyboard reachability, with explicit Enter/Space handlers.
 */
export default function ActivityRow({
  entry,
  isNew,
  onChip,
  isLastInGroup,
  isExpanded = false,
  onToggleExpand,
  isCompact = false,
  isNarrow = false,
  isTapped = false,
  onToggleTapped,
}: Props) {
  const [hovered, setHovered] = useState(false);
  // Phase 2.6: ActivityRow owns the GuardrailModal state so the modal can be
  // opened from either the hover quick-action OR the expanded panel button,
  // and survives a hover-out (which unmounts RowQuickActions).
  const [showGuardrailModal, setShowGuardrailModal] = useState(false);

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

  const handleActivate = () => {
    if (isCompact) {
      onToggleTapped?.();
    } else {
      onToggleExpand?.();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleActivate();
    } else if (e.key === " ") {
      // Prevent page-scroll on Space when the row is focused.
      e.preventDefault();
      handleActivate();
    }
  };

  // Hover quick-actions only render at desktop (compact uses tap-to-reveal).
  const showHoverActions = !isCompact && hovered && !isExpanded;
  // Compact tap quick-actions render the 4th expand button so touch users
  // have a discoverable expand affordance.
  const showTapActions = isCompact && isTapped;

  // Inline tags are hidden at compact viewport (operator gets them via expand).
  const showInlineTags = !isCompact;

  const avatarEl = entry.agentId && (
    <span data-testid="activity-row-avatar" style={{ flexShrink: 0 }}>
      <GradientAvatar agentId={entry.agentId} size="xs" />
    </span>
  );

  const catIconEl = (
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
  );

  const agentChipEl = entry.agentId && (
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
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: isNarrow ? 140 : undefined,
        textAlign: "left",
      }}
    >
      {entry.agentId}
    </button>
  );

  const verbToolEl = (
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
  );

  const tierBadgeEl = tier && tierColor && entry.riskScore != null && (
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
        style={{
          fontSize: 9,
          color: tierColor,
          letterSpacing: "0.06em",
          fontWeight: 500,
        }}
      >
        {tier.toUpperCase()}
      </span>
    </button>
  );

  const decisionEl = showDecision && (
    <span data-testid="activity-row-decision" style={{ flexShrink: 0 }}>
      <DecisionBadge decision={entry.effectiveDecision} />
    </span>
  );

  const timeEl = (
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
  );

  const inlineTagsEls =
    showInlineTags &&
    tags.slice(0, 2).map((tag) => (
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
    ));

  const quickActionsEl = (showHoverActions || showTapActions) && (
    <RowQuickActions
      entry={entry}
      onAddGuardrail={() => setShowGuardrailModal(true)}
      includeExpand={showTapActions}
      onExpand={onToggleExpand}
    />
  );

  // Tier-info strip surfaces tier + score + decision underneath a tapped row
  // so touch operators get the same context that desktop hovers reveal via
  // the inline badges.
  const tierInfoStripEl = showTapActions && (
    <div
      data-testid="activity-row-tier-info-strip"
      style={{
        padding: "4px 14px 8px",
        background: "var(--cl-bg-04)",
        borderTop: "1px solid var(--cl-border-subtle)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 10,
        color: "var(--cl-text-muted)",
      }}
    >
      {tier && tierColor && entry.riskScore != null && (
        <span
          className="mono"
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: tierColor,
            }}
          />
          <span style={{ color: tierColor }}>{tier.toUpperCase()}</span>
          <span style={{ color: "var(--cl-text-secondary)" }}>{entry.riskScore}</span>
        </span>
      )}
      {showDecision && (
        <span data-testid="activity-row-tier-info-decision">
          <DecisionBadge decision={entry.effectiveDecision} />
        </span>
      )}
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className="mono"
          style={{
            fontSize: 9,
            color: "var(--cl-text-muted)",
            border: "1px solid var(--cl-border-subtle)",
            borderRadius: 2,
            padding: "1px 4px",
            background: "var(--cl-bg-02)",
          }}
        >
          {tag.toUpperCase()}
        </span>
      ))}
    </div>
  );

  const rootStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: isNarrow ? "column" : "row",
    alignItems: isNarrow ? "stretch" : "center",
    gap: isNarrow ? 6 : 10,
    padding: "8px 14px",
    borderBottom:
      isLastInGroup && !isExpanded && !showTapActions
        ? "none"
        : "1px solid var(--cl-border-subtle)",
    background: isExpanded
      ? "var(--cl-bg-04)"
      : isNew
        ? "color-mix(in srgb, var(--cl-accent) 12%, transparent)"
        : "var(--cl-bg-02)",
    boxShadow: leftBorder,
    minHeight: 36,
    animation,
    transition: "background 80ms var(--cl-ease)",
    minWidth: 0,
    cursor: "pointer",
    textAlign: "left",
  };

  // Mouse handlers only matter at desktop (compact uses tap, not hover).
  const mouseHandlers = isCompact
    ? {}
    : {
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
      };

  const rowBody = isNarrow ? (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        {avatarEl}
        {catIconEl}
        {agentChipEl}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {verbToolEl}
        {quickActionsEl}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          flexWrap: "wrap",
        }}
      >
        {tierBadgeEl}
        {decisionEl}
        <span style={{ flex: 1 }} />
        {timeEl}
      </div>
    </>
  ) : (
    <>
      {avatarEl}
      {catIconEl}
      {agentChipEl}
      {verbToolEl}
      {quickActionsEl}
      {inlineTagsEls}
      {tierBadgeEl}
      {decisionEl}
      {timeEl}
    </>
  );

  return (
    <>
      <div
        data-testid="activity-row-root"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        {...mouseHandlers}
        style={rootStyle}
      >
        {rowBody}
      </div>

      {tierInfoStripEl}

      {isExpanded && (
        <ActivityRowExpanded
          entry={entry}
          onAddGuardrail={() => setShowGuardrailModal(true)}
        />
      )}

      {showGuardrailModal && (
        <GuardrailModal
          entry={entry}
          description={describeEntry(entry)}
          onClose={() => setShowGuardrailModal(false)}
          onCreated={() => setShowGuardrailModal(false)}
        />
      )}
    </>
  );
}
