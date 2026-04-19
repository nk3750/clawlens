import { Link } from "react-router-dom";
import type { AgentInfo } from "../../lib/types";
import type { ChannelMeta } from "../../lib/channel-catalog";
import { relTime } from "../../lib/utils";
import GradientAvatar from "../GradientAvatar";
import {
  IDENTITY_WIDTH,
  IDENTITY_WIDTH_MOBILE,
  chipText,
} from "./utils";

interface Props {
  agent: AgentInfo;
  /** Pre-computed cadence label ("every 3h"). Null = no schedule to show. */
  scheduleLabel: string | null;
  /** Surface-filtered channel metadata from `surfacedChannelsForRow`. Order
   *  is most-frequent-first; main / unknown / unrenderable channels are
   *  already excluded by the parent. */
  channels: ChannelMeta[];
  /** Compact mode hides the secondary line and renders avatar-only. */
  mobile: boolean;
}

const NAME_MAX = 14;

function truncate(name: string): string {
  if (name.length <= NAME_MAX) return name;
  return `${name.slice(0, NAME_MAX - 1)}\u2026`;
}

function idleBadge(agent: AgentInfo): string | null {
  if (agent.status !== "idle" || !agent.lastActiveTimestamp) return null;
  const rel = relTime(agent.lastActiveTimestamp);
  if (rel === "just now") return "idle now";
  return `idle ${rel.replace(" ago", "")}`;
}

export default function FleetChartIdentity({
  agent,
  scheduleLabel,
  channels,
  mobile,
}: Props) {
  if (mobile) {
    return (
      <Link
        to={`/agent/${encodeURIComponent(agent.id)}`}
        className="shrink-0 flex items-center justify-center"
        style={{ width: IDENTITY_WIDTH_MOBILE }}
        aria-label={agent.name}
      >
        <GradientAvatar agentId={agent.id} size="xs" />
      </Link>
    );
  }

  const idle = scheduleLabel ? null : idleBadge(agent);
  const displayChannels = channels.slice(0, 2);
  const extraChannels = channels.length - displayChannels.length;
  const hasSecondary =
    scheduleLabel !== null || idle !== null || displayChannels.length > 0;

  return (
    <div
      className="shrink-0 flex flex-col justify-center gap-0.5 pr-3"
      style={{ width: IDENTITY_WIDTH }}
    >
      <Link
        to={`/agent/${encodeURIComponent(agent.id)}`}
        className="flex items-center gap-2 no-underline"
        style={{ color: "var(--cl-text-primary)", textDecoration: "none" }}
      >
        <GradientAvatar agentId={agent.id} size="xs" />
        <span
          className="font-sans text-xs font-semibold"
          style={{ color: "var(--cl-text-primary)" }}
          title={agent.name}
        >
          {truncate(agent.name)}
        </span>
        {agent.needsAttention && (
          <span
            className="shrink-0"
            style={{ color: "var(--cl-risk-high)", fontSize: 11 }}
            title="Needs attention"
            aria-label="needs attention"
          >
            ⚠
          </span>
        )}
      </Link>
      {hasSecondary && (
        <div
          className="flex items-center gap-1.5 label-mono truncate"
          style={{ fontSize: 10, color: "var(--cl-text-muted)" }}
          data-cl-fleet-identity-secondary
        >
          {scheduleLabel && (
            <span
              className="shrink-0"
              style={{ color: "var(--cl-text-muted)" }}
              data-cl-fleet-schedule-chip
            >
              ⏰ {scheduleLabel}
            </span>
          )}
          {!scheduleLabel && idle && (
            <span
              className="shrink-0"
              style={{ color: "var(--cl-text-muted)" }}
              data-cl-fleet-idle-chip
            >
              ⊘ {idle}
            </span>
          )}
          {displayChannels.map((c) => (
            <span
              key={c.id}
              className="shrink-0 rounded px-1"
              style={{
                color: c.color ?? "var(--cl-text-secondary)",
                backgroundColor:
                  "color-mix(in srgb, var(--cl-text-muted) 12%, transparent)",
              }}
              data-cl-fleet-channel-chip={c.id}
              title={c.label}
            >
              {chipText(c)}
            </span>
          ))}
          {extraChannels > 0 && (
            <span className="shrink-0" style={{ color: "var(--cl-text-muted)" }}>
              +{extraChannels}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
