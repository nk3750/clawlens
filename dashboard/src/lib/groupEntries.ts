import { formatEventTarget, toolNamespace, verbFor } from "./eventFormat";
import type { ActivityCategory, EntryResponse, RiskTier } from "./types";
import { riskTierFromScore } from "./utils";

export interface EntryGroup {
  id: string;
  entries: EntryResponse[];
  toolName: string;
  category: ActivityCategory;
  avgRisk: number;
  peakRisk: number;
  riskTier: RiskTier;
  commonPath?: string;
  startTime: string;
  endTime: string;
  duration: number; // ms
}

/**
 * One-line human-readable description for a single entry. Thin adapter over
 * eventFormat primitives (spec §7). The legacy one-liner format is preserved
 * for the 7 callers that still render this string directly (LiveFeed-specific
 * two-line rendering goes through verbFor/formatEventTarget directly, not here).
 */
export function describeEntry(e: EntryResponse): string {
  const verb = verbFor(e);
  const target = formatEventTarget(e);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  if (e.toolName === "exec") {
    const ns = toolNamespace(e);
    const primary = ns.startsWith("shell.") ? ns.slice(6) : ns;
    return target
      ? `${cap(verb)} \`${primary} ${target.slice(0, 40)}\``
      : `${cap(verb)} command`;
  }
  return target ? `${cap(verb)} ${target}` : cap(verb);
}

/** Verb + noun for grouped descriptions */
export function groupVerb(toolName: string): { verb: string; noun: string } {
  switch (toolName) {
    case "read": return { verb: "Read", noun: "files" };
    case "write": return { verb: "Wrote", noun: "files" };
    case "edit": return { verb: "Edited", noun: "files" };
    case "exec": return { verb: "Ran", noun: "commands" };
    case "fetch_url": return { verb: "Fetched", noun: "URLs" };
    case "grep": return { verb: "Searched", noun: "patterns" };
    // pi-coding-agent registers `find` and `ls` (not `glob`); see issue #47.
    case "find": return { verb: "Found", noun: "files" };
    case "ls": return { verb: "Listed", noun: "directories" };

    // changes
    case "apply_patch": return { verb: "Patched", noun: "files" };
    case "gateway": return { verb: "Configured", noun: "gateway" };

    // web
    case "x_search": return { verb: "Searched", noun: "X posts" };

    // scripts
    case "code_execution": return { verb: "Executed", noun: "code" };

    // orchestration
    case "sessions_history": return { verb: "Queried", noun: "session histories" };
    case "sessions_list": return { verb: "Listed", noun: "sessions" };
    case "sessions_send": return { verb: "Messaged", noun: "sessions" };
    case "sessions_yield": return { verb: "Yielded", noun: "sessions" };
    case "session_status": return { verb: "Checked", noun: "session statuses" };
    case "subagents": return { verb: "Managed", noun: "subagents" };
    case "agents_list": return { verb: "Listed", noun: "agents" };
    case "update_plan": return { verb: "Planned", noun: "steps" };

    // media
    case "image": return { verb: "Analyzed", noun: "images" };
    case "image_generate": return { verb: "Generated", noun: "images" };
    case "video_generate": return { verb: "Generated", noun: "videos" };
    case "music_generate": return { verb: "Generated", noun: "tracks" };
    case "tts": return { verb: "Spoke", noun: "phrases" };
    case "pdf": return { verb: "Analyzed", noun: "PDFs" };
    case "canvas": return { verb: "Used", noun: "canvas" };
    case "nodes": return { verb: "Operated", noun: "nodes" };

    default: return { verb: toolName, noun: "actions" };
  }
}

/** Find longest common path prefix from entry params */
export function findCommonPath(entries: EntryResponse[]): string | undefined {
  const paths = entries
    .map((e) => String(e.params.path ?? e.params.url ?? e.params.command ?? ""))
    .filter(Boolean);
  if (paths.length === 0) return undefined;
  const parts = paths.map((p) => p.split("/"));
  const common: string[] = [];
  for (let i = 0; i < parts[0].length; i++) {
    const seg = parts[0][i];
    if (parts.every((p) => p[i] === seg)) common.push(seg);
    else break;
  }
  const result = common.join("/");
  return result.length > 1 ? result : undefined;
}

function isIntervention(decision?: string): boolean {
  return decision === "block" || decision === "denied" || decision === "approved" || decision === "pending";
}

function makeGroup(entries: EntryResponse[]): EntryGroup {
  const scores = entries.filter((e) => e.riskScore != null).map((e) => e.riskScore!);
  const avgRisk = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const peakRisk = scores.length > 0 ? Math.max(...scores) : 0;
  const startTime = entries[0].timestamp;
  const endTime = entries[entries.length - 1].timestamp;
  return {
    id: `${entries[0].toolCallId ?? entries[0].timestamp}-group`,
    entries,
    toolName: entries[0].toolName,
    category: entries[0].category,
    avgRisk,
    peakRisk,
    riskTier: riskTierFromScore(avgRisk),
    commonPath: findCommonPath(entries),
    startTime,
    endTime,
    duration: new Date(endTime).getTime() - new Date(startTime).getTime(),
  };
}

/**
 * Group consecutive entries by same tool, same risk tier, within 60s,
 * breaking on intervention decisions.
 */
export function groupEntries(entries: EntryResponse[]): EntryGroup[] {
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const result: EntryGroup[] = [];
  let i = 0;

  while (i < sorted.length) {
    const current = sorted[i];
    const currentTier = current.riskScore != null ? riskTierFromScore(current.riskScore) : null;

    if (isIntervention(current.effectiveDecision)) {
      result.push(makeGroup([current]));
      i++;
      continue;
    }

    const group: EntryResponse[] = [current];
    let j = i + 1;

    while (j < sorted.length) {
      const next = sorted[j];
      if (isIntervention(next.effectiveDecision)) break;
      if (next.toolName !== current.toolName) break;
      const nextTier = next.riskScore != null ? riskTierFromScore(next.riskScore) : null;
      if (nextTier !== currentTier) break;
      const gap = Math.abs(
        new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime(),
      );
      if (gap > 60_000) break;
      group.push(next);
      j++;
    }

    result.push(makeGroup(group));
    i = j;
  }

  return result;
}
