import type { EntryResponse, ActivityCategory, RiskTier } from "./types";
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

/** Describe an entry in plain language */
export function describeEntry(e: EntryResponse): string {
  const p = e.params;
  switch (e.toolName) {
    case "read": return p.path ? `Read ${p.path}` : "Read file";
    case "write": return p.path ? `Wrote ${p.path}` : "Wrote file";
    case "edit": return p.path ? `Edited ${p.path}` : "Edited file";
    case "exec": return p.command ? `Ran \`${String(p.command).slice(0, 50)}\`` : "Executed command";
    case "message": return p.subject ? `Sent "${p.subject}"` : "Sent message";
    case "fetch_url": return p.url ? `Fetched ${String(p.url).slice(0, 50)}` : "Fetched URL";
    case "grep": return p.pattern ? `Searched for "${p.pattern}"` : "Searched";
    case "glob": return p.pattern ? `Scanned ${p.pattern}` : "Scanned files";
    default: return e.toolName;
  }
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
    case "glob": return { verb: "Scanned", noun: "patterns" };
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
