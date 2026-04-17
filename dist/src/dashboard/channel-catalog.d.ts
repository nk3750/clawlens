/**
 * Channel catalog — single source of truth for session-key channel metadata.
 *
 * OpenClaw exposes an open space of session-key channels: execution contexts
 * (`main`, `subagent`, `cron`, `heartbeat`, `hook`), messaging providers
 * (`telegram`, `slack`, `matrix`, ...), and an explicit `unknown` fallback.
 * Third-party plugins can register anything. `resolveChannel` always returns
 * a meta object — unknown ids get a synthesized meta so callers never null-check.
 *
 * Mirrored in `dashboard/src/lib/channel-catalog.ts`. Keep the two in sync.
 */
export type ChannelKind = "direct" | "subagent" | "schedule" | "hook" | "messaging" | "unknown";
export interface ChannelMeta {
    id: string;
    kind: ChannelKind;
    label: string;
    shortLabel: string;
    iconPath: string;
    color?: string;
}
/**
 * Resolve a channel id to its metadata. Unknown ids get a synthesized meta
 * with `kind: "unknown"`, title-cased label, and the generic unknown icon.
 */
export declare function resolveChannel(channelId: string): ChannelMeta;
export interface ParsedSessionKey {
    agentId: string;
    channel: ChannelMeta;
    subPath: string[];
    raw: string;
}
/**
 * Parse `agent:<id>:<channel>:<...subPath>` into structured form.
 * Returns null for anything that doesn't start with `agent:<id>:<channel>`.
 */
export declare function parseSessionKey(raw: string): ParsedSessionKey | null;
