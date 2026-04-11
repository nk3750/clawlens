import { AuditLogger } from "../audit/logger";
import { extractIdentityKey } from "../guardrails/identity";
import { parseExecCommand } from "../risk/exec-parser";
import { computeBreakdown, describeAction, getCategory, parseSessionContext, riskPosture, } from "./categories";
// ── Internal helpers ────────────────────────────────────
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;
/** Filter entries to the last 24 hours (rolling window, timezone-agnostic). */
function getTodayEntries(entries) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return entries.filter((e) => e.timestamp >= cutoff);
}
/** Compute the effective user-facing decision for an entry. */
export function getEffectiveDecision(entry) {
    if (entry.userResponse === "approved")
        return "approved";
    if (entry.userResponse === "denied")
        return "denied";
    if (entry.userResponse === "timeout")
        return "timeout";
    if (entry.decision === "allow")
        return "allow";
    if (entry.decision === "block")
        return "block";
    if (entry.decision === "approval_required") {
        // In observe mode, approval_required is logged but never enforced —
        // the action goes through. Only show "pending" if there's no result yet
        // AND no indication it was allowed through.
        return entry.executionResult ? entry.executionResult : "allow";
    }
    if (entry.executionResult)
        return entry.executionResult;
    return "unknown";
}
/** True if the entry represents a policy decision (not a result log). */
function isDecisionEntry(entry) {
    return entry.decision !== undefined;
}
/** Get the final effective risk score for an entry, using LLM-adjusted score when available. */
function getEffectiveScore(entry, evalIdx) {
    if (evalIdx && entry.toolCallId) {
        const evalEntry = evalIdx.get(entry.toolCallId);
        if (evalEntry?.llmEvaluation) {
            return evalEntry.llmEvaluation.adjustedScore;
        }
    }
    return entry.riskScore;
}
function mapEntry(entry, evalIndex, guardrailStore) {
    // If there's an LLM eval for this tool call, use its adjusted score/tier/tags
    const evalEntry = entry.toolCallId ? evalIndex?.get(entry.toolCallId) : undefined;
    const llmEval = evalEntry?.llmEvaluation ?? entry.llmEvaluation;
    // Check if an active guardrail matches this entry
    let guardrailMatch;
    if (guardrailStore && entry.decision) {
        const key = extractIdentityKey(entry.toolName, entry.params);
        const matched = guardrailStore.peek(entry.agentId || "unknown", entry.toolName, key);
        if (matched) {
            guardrailMatch = { id: matched.id, action: matched.action };
        }
    }
    return {
        timestamp: entry.timestamp,
        toolName: entry.toolName,
        toolCallId: entry.toolCallId,
        params: entry.params,
        policyRule: entry.policyRule,
        decision: entry.decision,
        effectiveDecision: getEffectiveDecision(entry),
        severity: entry.severity,
        userResponse: entry.userResponse,
        executionResult: entry.executionResult,
        durationMs: entry.durationMs,
        riskScore: llmEval ? llmEval.adjustedScore : entry.riskScore,
        originalRiskScore: llmEval ? entry.riskScore : undefined,
        riskTier: evalEntry?.riskTier ?? entry.riskTier,
        riskTags: evalEntry?.riskTags ?? entry.riskTags,
        llmEvaluation: llmEval,
        agentId: entry.agentId,
        sessionKey: entry.sessionKey,
        category: getCategory(entry.toolName),
        execCategory: entry.toolName === "exec" && typeof entry.params.command === "string"
            ? parseExecCommand(entry.params.command).category
            : undefined,
        guardrailMatch,
    };
}
/** Build an index of LLM evaluation entries keyed by the toolCallId they reference. */
function buildEvalIndex(entries) {
    const index = new Map();
    for (const e of entries) {
        if (e.refToolCallId && e.llmEvaluation) {
            index.set(e.refToolCallId, e);
        }
    }
    return index;
}
/**
 * Group entries into sessions. When a session key is reused across cron runs
 * with a gap > SESSION_GAP_MS between consecutive entries, split into separate
 * logical sessions (appending #2, #3 etc. to the key).
 */
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes
function groupBySessions(entries) {
    // First pass: group by raw session key
    const raw = new Map();
    for (const e of entries) {
        if (!e.sessionKey)
            continue;
        const existing = raw.get(e.sessionKey);
        if (existing) {
            existing.push(e);
        }
        else {
            raw.set(e.sessionKey, [e]);
        }
    }
    // Second pass: split sessions with time gaps
    const sessions = new Map();
    for (const [key, group] of raw) {
        const sorted = group.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        let runIndex = 1;
        let current = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
            const gap = new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime();
            if (gap > SESSION_GAP_MS) {
                // Store current run
                const runKey = runIndex === 1 ? key : `${key}#${runIndex}`;
                sessions.set(runKey, current);
                runIndex++;
                current = [sorted[i]];
            }
            else {
                current.push(sorted[i]);
            }
        }
        // Store last run
        const runKey = runIndex === 1 ? key : `${key}#${runIndex}`;
        sessions.set(runKey, current);
    }
    return sessions;
}
/**
 * Resolve a session key (possibly with #N suffix from splitting) to its entries.
 * Handles both raw keys (exact match) and split keys (re-runs groupBySessions).
 */
function resolveSessionEntries(entries, sessionKey) {
    // Try direct match first (works for non-split sessions)
    const direct = entries.filter((e) => e.sessionKey === sessionKey);
    if (direct.length > 0)
        return direct;
    // If key has #N suffix, resolve through groupBySessions
    const hashIdx = sessionKey.lastIndexOf("#");
    if (hashIdx === -1)
        return [];
    const baseKey = sessionKey.slice(0, hashIdx);
    const baseEntries = entries.filter((e) => e.sessionKey === baseKey);
    if (baseEntries.length === 0)
        return [];
    const grouped = groupBySessions(baseEntries);
    return grouped.get(sessionKey) ?? [];
}
function buildSessionInfo(sessionKey, entries, evalIdx) {
    const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const startTime = sorted[0].timestamp;
    const endTime = sorted[sorted.length - 1].timestamp;
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const decisions = entries.filter(isDecisionEntry);
    let riskSum = 0;
    let riskCount = 0;
    let peakRisk = 0;
    for (const e of entries) {
        const score = getEffectiveScore(e, evalIdx);
        if (score !== undefined) {
            riskSum += score;
            riskCount++;
            if (score > peakRisk)
                peakRisk = score;
        }
    }
    let blockedCount = 0;
    for (const e of decisions) {
        const eff = getEffectiveDecision(e);
        if (eff === "block" || eff === "denied")
            blockedCount++;
    }
    // Tool summary: count by toolName, top 5
    const toolCounts = new Map();
    for (const e of decisions) {
        toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1);
    }
    const toolSummary = [...toolCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([toolName, count]) => ({
        toolName,
        category: getCategory(toolName),
        count,
    }));
    // Risk sparkline: chronological risk scores (using LLM-adjusted when available), max 20 points
    const chronoScores = sorted
        .map((e) => getEffectiveScore(e, evalIdx))
        .filter((s) => s !== undefined);
    let riskSparkline;
    if (chronoScores.length <= 20) {
        riskSparkline = chronoScores;
    }
    else {
        riskSparkline = [];
        for (let i = 0; i < 20; i++) {
            const idx = Math.round((i * (chronoScores.length - 1)) / 19);
            riskSparkline.push(chronoScores[idx]);
        }
    }
    return {
        sessionKey,
        agentId: entries.find((e) => e.agentId)?.agentId || "default",
        startTime,
        endTime,
        duration: endMs > startMs ? endMs - startMs : null,
        toolCallCount: decisions.length,
        avgRisk: riskCount > 0 ? Math.round(riskSum / riskCount) : 0,
        peakRisk,
        activityBreakdown: computeBreakdown(decisions),
        blockedCount,
        context: parseSessionContext(sessionKey),
        toolSummary,
        riskSparkline,
    };
}
// ── Date-filtered helpers ──────────────────────────────
/** Filter entries to a specific calendar day (YYYY-MM-DD). */
function getDayEntries(entries, date) {
    return entries.filter((e) => e.timestamp.startsWith(date));
}
/** Max single-day action count across all history. Returns 100 as fallback for fresh installs. */
export function computeHistoricDailyMax(entries) {
    const byDay = new Map();
    for (const entry of entries) {
        if (!entry.decision)
            continue;
        const day = entry.timestamp.slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    if (byDay.size === 0)
        return 100;
    return Math.max(...byDay.values());
}
/** Blocked + approval_required entries for a day, most recent first. */
export function getInterventions(entries, date) {
    const dayEntries = date ? getDayEntries(entries, date) : getTodayEntries(entries);
    const evalIdx = buildEvalIndex(entries);
    return dayEntries
        .filter((e) => e.decision === "block" || e.decision === "approval_required")
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 20)
        .map((e) => {
        const score = getEffectiveScore(e, evalIdx) ?? e.riskScore ?? 0;
        return {
            timestamp: e.timestamp,
            agentId: e.agentId ?? "unknown",
            agentName: e.agentId ?? "unknown",
            toolName: e.toolName,
            description: describeAction(e),
            riskScore: score,
            riskTier: score > 75 ? "critical" : score > 50 ? "high" : score > 25 ? "medium" : "low",
            decision: e.decision,
            effectiveDecision: getEffectiveDecision(e),
            sessionKey: e.sessionKey,
        };
    });
}
// ── Existing functions (unchanged signatures) ───────────
/** Compute today's decision counts. */
export function computeStats(entries) {
    const todayDecisions = getTodayEntries(entries).filter(isDecisionEntry);
    let allowed = 0;
    let approved = 0;
    let blocked = 0;
    let timedOut = 0;
    let pending = 0;
    for (const entry of todayDecisions) {
        const eff = getEffectiveDecision(entry);
        switch (eff) {
            case "allow":
                allowed++;
                break;
            case "approved":
                approved++;
                break;
            case "block":
            case "denied":
                blocked++;
                break;
            case "timeout":
                timedOut++;
                break;
            case "pending":
                pending++;
                break;
        }
    }
    return {
        total: allowed + approved + blocked + timedOut,
        allowed,
        approved,
        blocked,
        timedOut,
        pending,
    };
}
/** Return paginated decision entries in reverse chronological order, with optional filtering. */
export function getRecentEntries(entries, limit, offset, filters, guardrailStore) {
    const evalIdx = buildEvalIndex(entries);
    let filtered = entries.filter(isDecisionEntry);
    if (filters) {
        if (filters.agent) {
            const agentId = filters.agent;
            filtered = filtered.filter((e) => (e.agentId || "default") === agentId);
        }
        if (filters.category) {
            const cat = filters.category;
            filtered = filtered.filter((e) => getCategory(e.toolName) === cat);
        }
        if (filters.riskTier) {
            const tier = filters.riskTier;
            filtered = filtered.filter((e) => e.riskTier === tier);
        }
        if (filters.decision) {
            const decision = filters.decision;
            filtered = filtered.filter((e) => getEffectiveDecision(e) === decision);
        }
        if (filters.since && filters.since !== "all") {
            const ms = {
                "1h": 3_600_000,
                "6h": 21_600_000,
                "24h": 86_400_000,
                "7d": 604_800_000,
            };
            const cutoff = new Date(Date.now() - ms[filters.since]).toISOString();
            filtered = filtered.filter((e) => e.timestamp >= cutoff);
        }
    }
    const reversed = filtered.reverse();
    return reversed.slice(offset, offset + limit).map((e) => mapEntry(e, evalIdx, guardrailStore));
}
/** Verify the hash chain integrity of all entries. */
export function checkHealth(entries) {
    const result = AuditLogger.verifyChain(entries);
    return {
        valid: result.valid,
        brokenAt: result.brokenAt,
        totalEntries: entries.length,
    };
}
// ── New v2 functions ────────────────────────────────────
/** Enhanced stats with risk breakdown and active counts. Accepts optional date for past-day view. */
export function computeEnhancedStats(entries, date) {
    const isPastDay = date !== undefined;
    const windowEntries = isPastDay ? getDayEntries(entries, date) : getTodayEntries(entries);
    const windowDecisions = windowEntries.filter(isDecisionEntry);
    // Recompute base stats from window
    let allowed = 0;
    let approved = 0;
    let blocked = 0;
    let timedOut = 0;
    let pending = 0;
    for (const e of windowDecisions) {
        const eff = getEffectiveDecision(e);
        switch (eff) {
            case "allow":
                allowed++;
                break;
            case "approved":
                approved++;
                break;
            case "block":
            case "denied":
                blocked++;
                break;
            case "timeout":
                timedOut++;
                break;
            case "pending":
                pending++;
                break;
        }
    }
    const total = allowed + approved + blocked + timedOut;
    const evalIdx = buildEvalIndex(entries);
    let low = 0;
    let medium = 0;
    let high = 0;
    let critical = 0;
    let riskSum = 0;
    let riskCount = 0;
    let peakRisk = 0;
    for (const e of windowDecisions) {
        const evalEntry = e.toolCallId ? evalIdx.get(e.toolCallId) : undefined;
        const effectiveScore = evalEntry?.llmEvaluation?.adjustedScore ?? e.riskScore;
        const effectiveTier = evalEntry?.riskTier ?? e.riskTier;
        if (effectiveTier === "low")
            low++;
        else if (effectiveTier === "medium")
            medium++;
        else if (effectiveTier === "high")
            high++;
        else if (effectiveTier === "critical")
            critical++;
        if (effectiveScore !== undefined) {
            riskSum += effectiveScore;
            riskCount++;
            if (effectiveScore > peakRisk)
                peakRisk = effectiveScore;
        }
    }
    // Active agents/sessions: for past days, count distinct IDs; for today, use recency
    let activeAgents;
    let activeSessions;
    if (isPastDay) {
        const agentIds = new Set(windowDecisions.map((e) => e.agentId ?? "default"));
        const sessionKeys = new Set(windowDecisions.filter((e) => e.sessionKey).map((e) => e.sessionKey));
        activeAgents = agentIds.size;
        activeSessions = sessionKeys.size;
    }
    else {
        const now = Date.now();
        const activeAgentIds = new Set();
        const activeSessionKeys = new Set();
        for (const e of entries) {
            if (now - new Date(e.timestamp).getTime() <= ACTIVE_THRESHOLD_MS) {
                if (e.agentId)
                    activeAgentIds.add(e.agentId);
                if (e.sessionKey)
                    activeSessionKeys.add(e.sessionKey);
            }
        }
        activeAgents = activeAgentIds.size;
        activeSessions = activeSessionKeys.size;
    }
    const avgScore = riskCount > 0 ? Math.round(riskSum / riskCount) : 0;
    let posture = riskPosture(avgScore);
    // Posture overrides — only for today (past days are frozen snapshots)
    if (!isPastDay) {
        const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
        for (const e of windowDecisions) {
            const evalEntry = e.toolCallId ? evalIdx.get(e.toolCallId) : undefined;
            const score = evalEntry?.llmEvaluation?.adjustedScore ?? e.riskScore;
            if (e.timestamp >= oneHourAgo && score !== undefined && score > 75) {
                if (posture === "calm" || posture === "elevated")
                    posture = "high";
                break;
            }
        }
        const thirtyMinAgo = new Date(Date.now() - 1_800_000).toISOString();
        for (const e of windowDecisions) {
            if (e.timestamp >= thirtyMinAgo) {
                const eff = getEffectiveDecision(e);
                if (eff === "block" || eff === "denied") {
                    posture = "critical";
                    break;
                }
            }
        }
    }
    return {
        total,
        allowed,
        approved,
        blocked,
        timedOut,
        pending,
        riskBreakdown: { low, medium, high, critical },
        avgRiskScore: avgScore,
        peakRiskScore: peakRisk,
        activeAgents,
        activeSessions,
        riskPosture: posture,
        historicDailyMax: computeHistoricDailyMax(entries),
    };
}
/** Get aggregated agent list from audit entries. Accepts optional date for past-day view. */
export function getAgents(entries, date) {
    const isPastDay = date !== undefined;
    // When viewing a past day, pre-filter all entries to that day
    const scopedEntries = isPastDay ? getDayEntries(entries, date) : entries;
    const agentMap = new Map();
    for (const e of scopedEntries) {
        const id = e.agentId || "default";
        const existing = agentMap.get(id);
        if (existing) {
            existing.push(e);
        }
        else {
            agentMap.set(id, [e]);
        }
    }
    // For past days, only include agents that had decision entries
    if (isPastDay) {
        for (const [id, agentEntries] of agentMap) {
            if (!agentEntries.some(isDecisionEntry)) {
                agentMap.delete(id);
            }
        }
    }
    const now = Date.now();
    const todayCutoff = isPastDay ? date : new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const thirtyMinAgo = new Date(now - 1_800_000).toISOString();
    const evalIdx = buildEvalIndex(entries);
    const agents = [];
    for (const [id, agentEntries] of agentMap) {
        let lastTimestamp = null;
        for (const e of agentEntries) {
            if (!lastTimestamp || e.timestamp > lastTimestamp) {
                lastTimestamp = e.timestamp;
            }
        }
        // Past days: always idle. Today: active if activity in last 5 min.
        const isActive = isPastDay
            ? false
            : lastTimestamp
                ? now - new Date(lastTimestamp).getTime() <= ACTIVE_THRESHOLD_MS
                : false;
        const todayDecisions = isPastDay
            ? agentEntries.filter(isDecisionEntry)
            : agentEntries.filter((e) => e.timestamp >= todayCutoff && isDecisionEntry(e));
        let riskSum = 0;
        let riskCount = 0;
        let peakRisk = 0;
        const riskProfile = { low: 0, medium: 0, high: 0, critical: 0 };
        for (const e of agentEntries) {
            const score = getEffectiveScore(e, evalIdx);
            if (score !== undefined) {
                riskSum += score;
                riskCount++;
                if (score > peakRisk)
                    peakRisk = score;
                if (score > 75)
                    riskProfile.critical++;
                else if (score > 50)
                    riskProfile.high++;
                else if (score > 25)
                    riskProfile.medium++;
                else
                    riskProfile.low++;
            }
        }
        let currentSession;
        let currentSessionKey;
        const withSession = agentEntries
            .filter((e) => e.sessionKey)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        if (withSession.length > 0) {
            currentSessionKey = withSession[0].sessionKey;
            if (isActive) {
                const sessionEntries = agentEntries.filter((e) => e.sessionKey === currentSessionKey);
                const startTime = sessionEntries.reduce((min, e) => (e.timestamp < min ? e.timestamp : min), sessionEntries[0].timestamp);
                currentSession = {
                    sessionKey: currentSessionKey,
                    startTime,
                    toolCallCount: sessionEntries.filter(isDecisionEntry).length,
                };
            }
        }
        const hasCronSession = agentEntries.some((e) => {
            if (!e.sessionKey)
                return false;
            const parts = e.sessionKey.split(":");
            return parts.length >= 3 && parts[2] === "cron";
        });
        const mode = hasCronSession ? "scheduled" : "interactive";
        const currentContext = currentSessionKey ? parseSessionContext(currentSessionKey) : undefined;
        const breakdownEntries = currentSessionKey
            ? agentEntries.filter((e) => e.sessionKey === currentSessionKey && isDecisionEntry(e))
            : todayDecisions;
        const activityBreakdown = computeBreakdown(breakdownEntries);
        const todayActivityBreakdown = computeBreakdown(todayDecisions);
        const latestDecision = agentEntries
            .filter(isDecisionEntry)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
        const latestAction = latestDecision ? describeAction(latestDecision) : undefined;
        const latestActionTime = latestDecision?.timestamp;
        const sessionRiskEntries = currentSessionKey
            ? agentEntries.filter((e) => e.sessionKey === currentSessionKey && getEffectiveScore(e, evalIdx) !== undefined)
            : agentEntries.filter((e) => getEffectiveScore(e, evalIdx) !== undefined);
        let sessionRiskSum = 0;
        for (const e of sessionRiskEntries) {
            sessionRiskSum += getEffectiveScore(e, evalIdx);
        }
        const sessionAvg = sessionRiskEntries.length > 0 ? Math.round(sessionRiskSum / sessionRiskEntries.length) : 0;
        const agentPosture = riskPosture(sessionAvg);
        let needsAttention = false;
        let attentionReason;
        if (isPastDay) {
            // Past day: flag if any blocked entries occurred that day
            for (const e of agentEntries) {
                if (isDecisionEntry(e)) {
                    const eff = getEffectiveDecision(e);
                    if (eff === "block" || eff === "denied") {
                        needsAttention = true;
                        attentionReason = `Blocked: ${e.toolName}`;
                        break;
                    }
                }
            }
        }
        else {
            // Today: blocked in last 30 min
            for (const e of agentEntries) {
                if (e.timestamp >= thirtyMinAgo && isDecisionEntry(e)) {
                    const eff = getEffectiveDecision(e);
                    if (eff === "block" || eff === "denied") {
                        needsAttention = true;
                        attentionReason = `Blocked: ${e.toolName}`;
                        break;
                    }
                }
            }
        }
        if (!needsAttention && peakRisk >= 75) {
            needsAttention = true;
            attentionReason = "High risk activity detected";
        }
        let blockedCount = 0;
        for (const e of todayDecisions) {
            const eff = getEffectiveDecision(e);
            if (eff === "block" || eff === "denied")
                blockedCount++;
        }
        let topRisk;
        const topRiskEntry = agentEntries
            .filter((e) => isDecisionEntry(e) &&
            getEffectiveScore(e, evalIdx) !== undefined &&
            getEffectiveScore(e, evalIdx) >= 25)
            .sort((a, b) => (getEffectiveScore(b, evalIdx) ?? 0) - (getEffectiveScore(a, evalIdx) ?? 0))[0];
        if (topRiskEntry) {
            const score = getEffectiveScore(topRiskEntry, evalIdx);
            topRisk = {
                description: describeAction(topRiskEntry),
                score,
                tier: score > 75 ? "critical" : score > 50 ? "high" : score > 25 ? "medium" : "low",
            };
        }
        agents.push({
            id,
            name: id,
            status: isActive ? "active" : "idle",
            todayToolCalls: todayDecisions.length,
            avgRiskScore: riskCount > 0 ? Math.round(riskSum / riskCount) : 0,
            peakRiskScore: peakRisk,
            lastActiveTimestamp: lastTimestamp,
            currentSession,
            mode,
            currentContext,
            riskPosture: agentPosture,
            activityBreakdown,
            todayActivityBreakdown,
            latestAction,
            latestActionTime,
            needsAttention,
            attentionReason,
            blockedCount,
            riskProfile,
            topRisk,
        });
    }
    agents.sort((a, b) => {
        if (a.status !== b.status)
            return a.status === "active" ? -1 : 1;
        return (b.lastActiveTimestamp || "").localeCompare(a.lastActiveTimestamp || "");
    });
    return agents;
}
/** Get detailed info for a single agent. */
const RANGE_MS = {
    "3h": 3 * 3600000,
    "6h": 6 * 3600000,
    "12h": 12 * 3600000,
    "24h": 24 * 3600000,
};
export function getAgentDetail(entries, agentId, range) {
    const agentEntries = entries.filter((e) => (e.agentId || "default") === agentId);
    if (agentEntries.length === 0)
        return null;
    const agents = getAgents(entries);
    const agent = agents.find((a) => a.id === agentId);
    if (!agent)
        return null;
    const rangeMs = RANGE_MS[range ?? ""] ?? RANGE_MS["24h"];
    const windowCutoff = new Date(Date.now() - rangeMs).toISOString();
    const evalIdx = buildEvalIndex(entries);
    const sessionMap = groupBySessions(agentEntries);
    const allSessions = [];
    for (const [key, sEntries] of sessionMap) {
        allSessions.push(buildSessionInfo(key, sEntries, evalIdx));
    }
    allSessions.sort((a, b) => (b.endTime ?? b.startTime).localeCompare(a.endTime ?? a.startTime));
    // Build reverse lookup: entry key → split session key
    // so entries and riskTrend points use the correct sub-session (#2, #3, etc.)
    const splitSessionIndex = new Map();
    for (const [splitKey, sEntries] of sessionMap) {
        for (const e of sEntries) {
            const entryKey = e.toolCallId ?? e.timestamp;
            splitSessionIndex.set(entryKey, splitKey);
        }
    }
    const mapAndPatchSession = (e) => {
        const mapped = mapEntry(e, evalIdx);
        const entryKey = e.toolCallId ?? e.timestamp;
        mapped.sessionKey = splitSessionIndex.get(entryKey) ?? mapped.sessionKey;
        return mapped;
    };
    const recentActivity = agentEntries
        .filter((e) => isDecisionEntry(e) && e.timestamp >= windowCutoff)
        .reverse()
        .slice(0, 200)
        .map(mapAndPatchSession);
    // Current session activity: entries from the latest split sub-session only
    // For cron agents, the raw sessionKey spans many runs — use the most recent split
    const currentSessionKey = agent.currentSession?.sessionKey;
    const latestSplitKey = currentSessionKey
        ? allSessions.find((s) => s.sessionKey === currentSessionKey || s.sessionKey.startsWith(`${currentSessionKey}#`))?.sessionKey
        : undefined;
    const currentSessionActivity = latestSplitKey
        ? recentActivity.filter((e) => e.sessionKey === latestSplitKey)
        : [];
    // Risk trend: decision entries within range window with scores, chronological
    const riskTrend = agentEntries
        .filter((e) => isDecisionEntry(e) && e.timestamp >= windowCutoff && e.riskScore !== undefined)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(0, 200)
        .map((e) => {
        const evalEntry = e.toolCallId ? evalIdx.get(e.toolCallId) : undefined;
        const score = evalEntry?.llmEvaluation?.adjustedScore ?? e.riskScore ?? 0;
        const entryKey = e.toolCallId ?? e.timestamp;
        return {
            timestamp: e.timestamp,
            score,
            toolName: e.toolName,
            sessionKey: splitSessionIndex.get(entryKey) ?? e.sessionKey,
            toolCallId: e.toolCallId,
        };
    });
    return {
        agent,
        currentSessionActivity,
        recentActivity,
        sessions: allSessions.slice(0, 10),
        totalSessions: allSessions.length,
        riskTrend,
    };
}
/** Get paginated session list, optionally filtered by agent. */
export function getSessions(entries, agentId, limit = 10, offset = 0) {
    let filtered = entries;
    if (agentId) {
        filtered = entries.filter((e) => (e.agentId || "default") === agentId);
    }
    const evalIdx = buildEvalIndex(entries);
    const sessionMap = groupBySessions(filtered);
    const allSessions = [];
    for (const [key, sEntries] of sessionMap) {
        allSessions.push(buildSessionInfo(key, sEntries, evalIdx));
    }
    allSessions.sort((a, b) => (b.endTime ?? b.startTime).localeCompare(a.endTime ?? a.startTime));
    return {
        sessions: allSessions.slice(offset, offset + limit),
        total: allSessions.length,
    };
}
/** Get full detail for a single session. */
export function getSessionDetail(entries, sessionKey) {
    const sessionEntries = resolveSessionEntries(entries, sessionKey);
    if (sessionEntries.length === 0)
        return null;
    const evalIdx = buildEvalIndex(entries);
    const session = buildSessionInfo(sessionKey, sessionEntries, evalIdx);
    const mappedEntries = sessionEntries
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .map((e) => mapEntry(e, evalIdx));
    return { session, entries: mappedEntries };
}
//# sourceMappingURL=api.js.map