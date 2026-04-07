import type { AuditEntry } from "../audit/logger";
import type { ModelAuth } from "../types";
import { describeAction, getCategory } from "./categories";

export interface SessionSummary {
  sessionKey: string;
  summary: string;
  generatedAt: string;
}

interface CacheEntry {
  summary: SessionSummary;
  expiresAt: number | null; // null = permanent (ended session)
}

const summaryCache = new Map<string, CacheEntry>();

const ACTIVE_SESSION_TTL_MS = 60_000; // 60s for active sessions

/**
 * Check if a session appears to still be active (last entry within 5 min).
 */
function isSessionActive(entries: AuditEntry[]): boolean {
  if (entries.length === 0) return false;
  let latest = entries[0].timestamp;
  for (const e of entries) {
    if (e.timestamp > latest) latest = e.timestamp;
  }
  return Date.now() - new Date(latest).getTime() < 5 * 60 * 1000;
}

/**
 * Generate a template summary for sessions with few entries.
 */
function templateSummary(sessionKey: string, entries: AuditEntry[]): SessionSummary {
  const decisions = entries.filter((e) => e.decision !== undefined);
  const count = decisions.length;

  // Find dominant category
  const catCounts = new Map<string, number>();
  for (const e of decisions) {
    const cat = getCategory(e.toolName);
    catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
  }
  let topCat = "commands";
  let topCount = 0;
  for (const [cat, c] of catCounts) {
    if (c > topCount) {
      topCat = cat;
      topCount = c;
    }
  }

  const catLabels: Record<string, string> = {
    exploring: "exploration",
    changes: "file change",
    commands: "command",
    web: "web",
    comms: "communication",
    data: "data",
  };
  const catLabel = catLabels[topCat] || topCat;

  // Avg risk
  let riskSum = 0;
  let riskCount = 0;
  for (const e of entries) {
    if (e.riskScore !== undefined) {
      riskSum += e.riskScore;
      riskCount++;
    }
  }
  const avgRisk = riskCount > 0 ? Math.round(riskSum / riskCount) : 0;

  return {
    sessionKey,
    summary: `Ran ${count} ${catLabel} action${count !== 1 ? "s" : ""}. Avg risk: ${avgRisk}.`,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build the LLM prompt for session summarization.
 */
function buildSummaryPrompt(sessionKey: string, entries: AuditEntry[]): string {
  const decisions = entries
    .filter((e) => e.decision !== undefined)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const startTime = decisions[0]?.timestamp ?? "unknown";
  const endTime = decisions[decisions.length - 1]?.timestamp ?? "unknown";
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  const durationMs = endMs - startMs;
  const durationStr =
    durationMs > 60000 ? `${Math.round(durationMs / 60000)}m` : `${Math.round(durationMs / 1000)}s`;

  let riskSum = 0;
  let riskCount = 0;
  let peakRisk = 0;
  for (const e of entries) {
    if (e.riskScore !== undefined) {
      riskSum += e.riskScore;
      riskCount++;
      if (e.riskScore > peakRisk) peakRisk = e.riskScore;
    }
  }
  const avgRisk = riskCount > 0 ? Math.round(riskSum / riskCount) : 0;

  const toolLines = decisions
    .slice(0, 30)
    .map((e) => {
      const desc = describeAction(e);
      const risk = e.riskScore !== undefined ? `risk ${e.riskScore}` : "no score";
      const decision = e.decision || "unknown";
      return `- ${e.timestamp} ${e.toolName} ${desc} → ${risk} ${decision}`;
    })
    .join("\n");

  return `Summarize this agent session in 1-2 sentences. Focus on: what the agent did, whether anything was risky or blocked, and the outcome. Be concise and factual.

Session: ${sessionKey}
Duration: ${durationStr}
Actions: ${decisions.length}
Avg risk: ${avgRisk}, Peak: ${peakRisk}

Tool calls:
${toolLines}`;
}

/**
 * Get or generate a session summary.
 * Returns null if the session has no entries.
 */
export async function getSessionSummary(
  sessionKey: string,
  entries: AuditEntry[],
  config: { llmModel: string; llmApiKeyEnv: string; modelAuth?: ModelAuth; provider?: string },
): Promise<SessionSummary | null> {
  let sessionEntries = entries.filter((e) => e.sessionKey === sessionKey);

  // Handle split session keys (e.g., "agent:bot:cron:job#2")
  if (sessionEntries.length === 0) {
    const hashIdx = sessionKey.lastIndexOf("#");
    if (hashIdx !== -1) {
      const baseKey = sessionKey.slice(0, hashIdx);
      const runNum = parseInt(sessionKey.slice(hashIdx + 1), 10);
      const baseEntries = entries
        .filter((e) => e.sessionKey === baseKey)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      // Split by 30-min gaps and pick the right run
      const GAP_MS = 30 * 60 * 1000;
      const runs: AuditEntry[][] = [];
      let current: AuditEntry[] = [];
      for (const e of baseEntries) {
        if (current.length > 0) {
          const gap =
            new Date(e.timestamp).getTime() -
            new Date(current[current.length - 1].timestamp).getTime();
          if (gap > GAP_MS) {
            runs.push(current);
            current = [];
          }
        }
        current.push(e);
      }
      if (current.length > 0) runs.push(current);
      sessionEntries = runs[runNum - 1] ?? [];
    }
  }

  if (sessionEntries.length === 0) return null;

  // Check cache
  const cached = summaryCache.get(sessionKey);
  if (cached) {
    if (cached.expiresAt === null || Date.now() < cached.expiresAt) {
      return cached.summary;
    }
    // Expired — remove and regenerate
    summaryCache.delete(sessionKey);
  }

  const decisions = sessionEntries.filter((e) => e.decision !== undefined);
  const active = isSessionActive(sessionEntries);

  let summary: SessionSummary;

  if (decisions.length < 3) {
    summary = templateSummary(sessionKey, sessionEntries);
  } else {
    // Try LLM generation
    const llmSummary = await generateLlmSummary(sessionKey, sessionEntries, config);
    summary = llmSummary ?? templateSummary(sessionKey, sessionEntries);
  }

  // Cache: permanent for ended sessions, TTL for active
  summaryCache.set(sessionKey, {
    summary,
    expiresAt: active ? Date.now() + ACTIVE_SESSION_TTL_MS : null,
  });

  return summary;
}

async function generateLlmSummary(
  sessionKey: string,
  entries: AuditEntry[],
  config: { llmModel: string; llmApiKeyEnv: string; modelAuth?: ModelAuth; provider?: string },
): Promise<SessionSummary | null> {
  const prompt = buildSummaryPrompt(sessionKey, entries);

  // Resolve API key: modelAuth first, then env var
  let apiKey: string | undefined;

  // Path 1: modelAuth-resolved key
  if (config.modelAuth && config.provider) {
    try {
      apiKey = await config.modelAuth.resolveApiKeyForProvider(config.provider);
    } catch {
      // Fall through to env var
    }
  }

  // Path 2: explicit env var
  if (!apiKey) {
    apiKey = process.env[config.llmApiKeyEnv];
  }

  if (!apiKey) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const response = await Promise.race([
      client.messages.create({
        model: config.llmModel,
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Summary generation timeout (10s)")), 10_000),
      ),
    ]);

    const textBlocks = response.content.filter(
      (b): b is { type: "text"; text: string } => b.type === "text",
    );
    const text = textBlocks
      .map((b) => b.text)
      .join(" ")
      .trim();

    if (!text) return null;

    return {
      sessionKey,
      summary: text,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Exposed for testing — clears the summary cache. */
export function clearSummaryCache(): void {
  summaryCache.clear();
}

/** Exposed for testing — get cache size. */
export function getSummaryCacheSize(): number {
  return summaryCache.size;
}
