/**
 * Channel catalog — frontend mirror of `src/dashboard/channel-catalog.ts`.
 * Keep data and function signatures in sync with the backend copy.
 */

export type ChannelKind =
  | "direct"
  | "subagent"
  | "schedule"
  | "hook"
  | "messaging"
  | "unknown";

export interface ChannelMeta {
  id: string;
  kind: ChannelKind;
  label: string;
  shortLabel: string;
  iconPath: string;
  color?: string;
}

const ICON_USER =
  "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 11a4 4 0 100-8 4 4 0 000 8z";
const ICON_BRANCH =
  "M6 3v12 M18 9a3 3 0 100-6 3 3 0 000 6z M6 21a3 3 0 100-6 3 3 0 000 6z M18 9a9 9 0 01-9 9";
const ICON_CLOCK = "M12 2a10 10 0 100 20 10 10 0 000-20z M12 6v6l4 2";
const ICON_PULSE = "M22 12h-4l-3 9L9 3l-3 9H2";
const ICON_LINK =
  "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71 M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71";
const ICON_HELP =
  "M12 2a10 10 0 100 20 10 10 0 000-20z M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3 M12 17h.01";
const ICON_MESSAGE = "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z";

const CATALOG: Record<string, ChannelMeta> = {
  main: { id: "main", kind: "direct", label: "Direct", shortLabel: "", iconPath: ICON_USER },
  subagent: {
    id: "subagent",
    kind: "subagent",
    label: "Subagent",
    shortLabel: "",
    iconPath: ICON_BRANCH,
  },
  cron: {
    id: "cron",
    kind: "schedule",
    label: "Cron",
    shortLabel: "\u23F0",
    iconPath: ICON_CLOCK,
  },
  heartbeat: {
    id: "heartbeat",
    kind: "schedule",
    label: "Heartbeat",
    shortLabel: "\u2665",
    iconPath: ICON_PULSE,
  },
  hook: { id: "hook", kind: "hook", label: "Hook", shortLabel: "\u21E2", iconPath: ICON_LINK },
  unknown: {
    id: "unknown",
    kind: "unknown",
    label: "Unknown",
    shortLabel: "?",
    iconPath: ICON_HELP,
  },
  telegram: {
    id: "telegram",
    kind: "messaging",
    label: "Telegram",
    shortLabel: "tg",
    iconPath: ICON_MESSAGE,
    color: "#229ED9",
  },
  whatsapp: {
    id: "whatsapp",
    kind: "messaging",
    label: "WhatsApp",
    shortLabel: "wa",
    iconPath: ICON_MESSAGE,
    color: "#25D366",
  },
  slack: {
    id: "slack",
    kind: "messaging",
    label: "Slack",
    shortLabel: "sk",
    iconPath: ICON_MESSAGE,
    color: "#4A154B",
  },
  discord: {
    id: "discord",
    kind: "messaging",
    label: "Discord",
    shortLabel: "dc",
    iconPath: ICON_MESSAGE,
    color: "#5865F2",
  },
  matrix: {
    id: "matrix",
    kind: "messaging",
    label: "Matrix",
    shortLabel: "mx",
    iconPath: ICON_MESSAGE,
    color: "#000000",
  },
  imessage: {
    id: "imessage",
    kind: "messaging",
    label: "iMessage",
    shortLabel: "im",
    iconPath: ICON_MESSAGE,
    color: "#34C759",
  },
  signal: {
    id: "signal",
    kind: "messaging",
    label: "Signal",
    shortLabel: "sg",
    iconPath: ICON_MESSAGE,
    color: "#3A76F0",
  },
  line: {
    id: "line",
    kind: "messaging",
    label: "LINE",
    shortLabel: "ln",
    iconPath: ICON_MESSAGE,
    color: "#00B900",
  },
  feishu: {
    id: "feishu",
    kind: "messaging",
    label: "Feishu",
    shortLabel: "fs",
    iconPath: ICON_MESSAGE,
    color: "#00D6B9",
  },
  msteams: {
    id: "msteams",
    kind: "messaging",
    label: "MS Teams",
    shortLabel: "mt",
    iconPath: ICON_MESSAGE,
    color: "#4B53BC",
  },
  mattermost: {
    id: "mattermost",
    kind: "messaging",
    label: "Mattermost",
    shortLabel: "mm",
    iconPath: ICON_MESSAGE,
    color: "#0058CC",
  },
  bluebubbles: {
    id: "bluebubbles",
    kind: "messaging",
    label: "BlueBubbles",
    shortLabel: "bb",
    iconPath: ICON_MESSAGE,
    color: "#3B82F6",
  },
  "nextcloud-talk": {
    id: "nextcloud-talk",
    kind: "messaging",
    label: "Nextcloud Talk",
    shortLabel: "nc",
    iconPath: ICON_MESSAGE,
    color: "#0082C9",
  },
  nostr: {
    id: "nostr",
    kind: "messaging",
    label: "Nostr",
    shortLabel: "ns",
    iconPath: ICON_MESSAGE,
    color: "#8B5CF6",
  },
  zalo: {
    id: "zalo",
    kind: "messaging",
    label: "Zalo",
    shortLabel: "zl",
    iconPath: ICON_MESSAGE,
    color: "#0068FF",
  },
  webchat: {
    id: "webchat",
    kind: "messaging",
    label: "Web chat",
    shortLabel: "wc",
    iconPath: ICON_MESSAGE,
  },
};

function titleCase(raw: string): string {
  if (!raw) return "";
  return raw
    .split(/[-_]/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ""))
    .filter((w) => w.length > 0)
    .join(" ");
}

export function resolveChannel(channelId: string): ChannelMeta {
  const hit = CATALOG[channelId];
  if (hit) return hit;
  return {
    id: channelId,
    kind: "unknown",
    label: titleCase(channelId) || "Unknown",
    shortLabel: channelId.slice(0, 2),
    iconPath: CATALOG.unknown.iconPath,
  };
}

export interface ParsedSessionKey {
  agentId: string;
  channel: ChannelMeta;
  subPath: string[];
  raw: string;
}

export function parseSessionKey(raw: string): ParsedSessionKey | null {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length < 3 || parts[0] !== "agent") return null;
  return {
    agentId: parts[1],
    channel: resolveChannel(parts[2]),
    subPath: parts.slice(3),
    raw,
  };
}
