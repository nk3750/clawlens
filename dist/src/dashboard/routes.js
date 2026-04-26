import * as fs from "node:fs";
import * as path from "node:path";
import { extractIdentityKey } from "../guardrails/identity";
import { GuardrailStore } from "../guardrails/store";
import { isValidGuardrailAction } from "../guardrails/types";
import { buildEvalIndex, checkHealth, computeEnhancedStats, computeFleetRiskIndex, getActivityTimeline, getAgentDetail, getAgents, getAttention, getFleetActivity, getInterventions, getRecentEntries, getSessionDetail, getSessions, localDateOf, localToday, mapEntry, resolveSplitKeyForEntry, } from "./api";
import { AttentionStore, isValidAckScope } from "./attention-state";
import { getDashboardHtml } from "./html";
import { getSessionSummary } from "./session-summary";
const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};
export function registerDashboardRoutes(api, deps) {
    const distDir = deps.pluginDir ? path.join(deps.pluginDir, "dashboard", "dist") : null;
    api.registerHttpRoute({
        path: "/plugins/clawlens",
        auth: "plugin",
        match: "prefix",
        replaceExisting: true,
        handler: async (req, res) => {
            const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
            // Strip the route prefix to get the sub-path
            let subPath = url.pathname;
            if (subPath.startsWith("/plugins/clawlens")) {
                subPath = subPath.slice("/plugins/clawlens".length);
            }
            subPath = subPath.replace(/^\//, "");
            // ── API routes ──────────────────────────────
            // ── Guardrails CRUD ─────────────────────────
            if (subPath === "api/guardrails" && req.method === "POST") {
                if (!deps.guardrailStore) {
                    res.writeHead(501, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Guardrails not configured" }));
                    return true;
                }
                const body = await readBody(req);
                const { toolCallId, action, agentScope } = body;
                if (!toolCallId || !action) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "toolCallId and action are required" }));
                    return true;
                }
                if (!isValidGuardrailAction(action)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        error: "Invalid action. Must be block or require_approval",
                    }));
                    return true;
                }
                const entries = deps.auditLogger.readEntries();
                const entry = entries.find((e) => e.toolCallId === toolCallId && e.decision);
                if (!entry) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Audit entry not found" }));
                    return true;
                }
                const identityKey = extractIdentityKey(entry.toolName, entry.params);
                const agentId = agentScope === "global" ? null : (entry.agentId ?? null);
                // Idempotency: if a guardrail already exists at the exact (agentId,
                // tool, identityKey) tuple, return it without duplicating. This
                // protects against operator double-clicks and SSE-driven retries.
                // Action-of-record is the existing guardrail's action — operators
                // who want to change it should edit the row in /guardrails.
                const existing = deps.guardrailStore.findExact(agentId, entry.toolName, identityKey);
                if (existing) {
                    sendJson(res, { ...existing, existing: true });
                    return true;
                }
                const describeAction = (tn, p) => {
                    const val = typeof p.command === "string"
                        ? p.command
                        : typeof p.path === "string"
                            ? p.path
                            : typeof p.url === "string"
                                ? p.url
                                : typeof p.query === "string"
                                    ? p.query
                                    : "";
                    return val ? `${tn} — ${val}` : tn;
                };
                const guardrail = {
                    id: GuardrailStore.generateId(),
                    tool: entry.toolName,
                    identityKey,
                    matchMode: "exact",
                    action,
                    agentId,
                    createdAt: new Date().toISOString(),
                    source: {
                        toolCallId,
                        sessionKey: entry.sessionKey ?? "",
                        agentId: entry.agentId ?? "unknown",
                    },
                    description: describeAction(entry.toolName, entry.params),
                    riskScore: entry.riskScore ?? 0,
                };
                deps.guardrailStore.add(guardrail);
                sendJson(res, { ...guardrail, existing: false });
                return true;
            }
            if (subPath === "api/guardrails" && req.method === "GET") {
                if (!deps.guardrailStore) {
                    sendJson(res, { guardrails: [] });
                    return true;
                }
                const agentId = url.searchParams.get("agentId") || undefined;
                sendJson(res, { guardrails: deps.guardrailStore.list(agentId ? { agentId } : undefined) });
                return true;
            }
            const guardrailIdMatch = subPath.match(/^api\/guardrails\/([^/]+)$/);
            if (guardrailIdMatch && req.method === "PUT") {
                if (!deps.guardrailStore) {
                    res.writeHead(501, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Guardrails not configured" }));
                    return true;
                }
                const id = decodeURIComponent(guardrailIdMatch[1]);
                const body = await readBody(req);
                const patch = body;
                if (patch.action !== undefined && !isValidGuardrailAction(patch.action)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        error: "Invalid action. Must be block or require_approval",
                    }));
                    return true;
                }
                const updated = deps.guardrailStore.update(id, patch);
                if (!updated) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Guardrail not found" }));
                    return true;
                }
                sendJson(res, updated);
                return true;
            }
            if (guardrailIdMatch && req.method === "DELETE") {
                if (!deps.guardrailStore) {
                    res.writeHead(501, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Guardrails not configured" }));
                    return true;
                }
                const id = decodeURIComponent(guardrailIdMatch[1]);
                const removed = deps.guardrailStore.remove(id);
                if (!removed) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Guardrail not found" }));
                    return true;
                }
                sendJson(res, { ok: true });
                return true;
            }
            // ── Core API routes ─────────────────────────
            if (subPath === "api/stats") {
                const date = url.searchParams.get("date") || undefined;
                const entries = deps.auditLogger.readEntries();
                sendJson(res, computeEnhancedStats(entries, date));
                return true;
            }
            if (subPath === "api/fleet-risk-index") {
                const entries = deps.auditLogger.readEntries();
                sendJson(res, computeFleetRiskIndex(entries));
                return true;
            }
            if (subPath === "api/entries") {
                const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
                const offset = clampInt(url.searchParams.get("offset"), 0, Infinity, 0);
                const filters = {};
                const agent = url.searchParams.get("agent");
                if (agent)
                    filters.agent = agent;
                const category = url.searchParams.get("category");
                if (category)
                    filters.category = category;
                const riskTier = url.searchParams.get("riskTier");
                if (riskTier)
                    filters.riskTier = riskTier;
                const decision = url.searchParams.get("decision");
                if (decision)
                    filters.decision = decision;
                const since = url.searchParams.get("since");
                if (since)
                    filters.since = since;
                const entries = deps.auditLogger.readEntries();
                sendJson(res, getRecentEntries(entries, limit, offset, filters, deps.guardrailStore));
                return true;
            }
            if (subPath === "api/activity-timeline") {
                const range = url.searchParams.get("range") || undefined;
                const rawBucket = url.searchParams.get("bucketMinutes");
                const bucketMinutes = rawBucket !== null ? clampInt(rawBucket, 1, 60, 15) : undefined;
                const date = url.searchParams.get("date") || undefined;
                const entries = deps.auditLogger.readEntries();
                sendJson(res, getActivityTimeline(entries, bucketMinutes, date, range));
                return true;
            }
            if (subPath === "api/fleet-activity") {
                const range = url.searchParams.get("range") || undefined;
                const date = url.searchParams.get("date") || undefined;
                const entries = deps.auditLogger.readEntries();
                sendJson(res, getFleetActivity(entries, range, date, deps.guardrailStore));
                return true;
            }
            if (subPath === "api/health") {
                // Hash-chain verification must run against the raw, un-deduped log
                // or prev-hash links across dropped duplicates look broken.
                const entries = deps.auditLogger.readEntriesRaw();
                sendJson(res, checkHealth(entries));
                return true;
            }
            if (subPath === "api/audit/export") {
                const requested = url.searchParams.get("date");
                const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : localToday();
                if (requested && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid date format. Use YYYY-MM-DD." }));
                    return true;
                }
                res.writeHead(200, {
                    "Content-Type": "application/x-ndjson; charset=utf-8",
                    "Content-Disposition": `attachment; filename="clawlens-audit-${date}.jsonl"`,
                    "Cache-Control": "no-cache",
                });
                // Stream entry-by-entry rather than buffering the whole day in memory:
                // a busy day can be tens of MB of JSONL.
                for (const e of deps.auditLogger.readEntries()) {
                    if (localDateOf(e.timestamp) === date) {
                        res.write(`${JSON.stringify(e)}\n`);
                    }
                }
                res.end();
                return true;
            }
            if (subPath === "api/agents") {
                const date = url.searchParams.get("date") || undefined;
                const entries = deps.auditLogger.readEntries();
                sendJson(res, getAgents(entries, date));
                return true;
            }
            if (subPath === "api/interventions") {
                const date = url.searchParams.get("date") || undefined;
                const entries = deps.auditLogger.readEntries();
                sendJson(res, getInterventions(entries, date, deps.guardrailStore));
                return true;
            }
            // ── Attention Inbox ─────────────────────────
            if (subPath === "api/attention" && req.method === "GET") {
                const entries = deps.auditLogger.readEntries();
                sendJson(res, getAttention(entries, deps.guardrailStore, deps.attentionStore));
                return true;
            }
            if (subPath === "api/attention/ack" && req.method === "POST") {
                if (!deps.attentionStore) {
                    res.writeHead(501, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Attention store not configured" }));
                    return true;
                }
                const body = (await readBody(req));
                if (!isValidAckScope(body.scope)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid scope" }));
                    return true;
                }
                // Single-verb semantics (#6): always writes action="ack". The schema
                // still accepts "dismiss" for backward compat on read, but the write
                // path never produces one.
                const record = {
                    id: AttentionStore.generateId(),
                    scope: body.scope,
                    ackedAt: new Date().toISOString(),
                    ackedBy: typeof body.ackedBy === "string" ? body.ackedBy : undefined,
                    action: "ack",
                    note: typeof body.note === "string" ? body.note : undefined,
                };
                deps.attentionStore.append(record);
                sendJson(res, { ok: true, id: record.id, ackedAt: record.ackedAt });
                return true;
            }
            if (subPath === "api/attention/resolve" && req.method === "POST") {
                // Kept wired for when upstream lands onRegistered (see
                // openclaw/openclaw#68626). Today the resolver closure only cleans our
                // stash and decorates audit — it does NOT unblock
                // plugin.approval.waitDecision.
                if (!deps.pendingApprovalStore) {
                    res.writeHead(501, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Approval store not configured" }));
                    return true;
                }
                const body = (await readBody(req));
                if (typeof body.toolCallId !== "string" ||
                    body.toolCallId.length === 0 ||
                    (body.decision !== "approve" && body.decision !== "deny")) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid body" }));
                    return true;
                }
                const entry = deps.pendingApprovalStore.take(body.toolCallId);
                if (!entry) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Already resolved", reason: "already_resolved" }));
                    return true;
                }
                // Translate the dashboard verb into the guardrail decision string
                // OpenClaw expects. "allow-once" proceeds without relaxing future
                // matches; "deny" blocks. We intentionally do NOT use "allow-always"
                // — that would silently disarm the guardrail; the user can do that
                // explicitly from the guardrails page.
                const openClawDecision = body.decision === "approve" ? "allow-once" : "deny";
                try {
                    await entry.resolve(openClawDecision);
                }
                catch (err) {
                    api.logger.error("pendingApproval.resolve threw:", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Resolver threw", message: String(err) }));
                    return true;
                }
                // Decorate the audit log so the resolution source is distinguishable
                // from Telegram / timeout. The inner guardrail resolution already
                // writes its own entry; this one adds dashboard provenance.
                deps.auditLogger.logApprovalResolution({
                    toolCallId: entry.toolCallId,
                    toolName: entry.toolName,
                    approved: body.decision === "approve",
                    resolvedBy: "dashboard",
                    note: typeof body.note === "string" ? body.note : undefined,
                    agentId: entry.agentId,
                });
                sendJson(res, {
                    ok: true,
                    resolvedAt: new Date().toISOString(),
                    decision: body.decision,
                });
                return true;
            }
            const agentMatch = subPath.match(/^api\/agent\/([^/]+)$/);
            if (agentMatch) {
                const agentId = decodeURIComponent(agentMatch[1]);
                const range = url.searchParams.get("range") || undefined;
                const entries = deps.auditLogger.readEntries();
                const detail = getAgentDetail(entries, agentId, range);
                if (!detail) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Agent not found" }));
                    return true;
                }
                sendJson(res, detail);
                return true;
            }
            if (subPath === "api/sessions") {
                const agentId = url.searchParams.get("agentId") || undefined;
                const limit = clampInt(url.searchParams.get("limit"), 1, 100, 10);
                const offset = clampInt(url.searchParams.get("offset"), 0, Infinity, 0);
                const entries = deps.auditLogger.readEntries();
                sendJson(res, getSessions(entries, agentId, limit, offset));
                return true;
            }
            const summaryMatch = subPath.match(/^api\/session\/(.+)\/summary$/);
            if (summaryMatch) {
                const sessionKey = decodeURIComponent(summaryMatch[1]);
                const entries = deps.auditLogger.readEntries();
                const riskConfig = deps.config?.risk ?? {
                    llmModel: "claude-haiku-4-5-20251001",
                    llmApiKeyEnv: "ANTHROPIC_API_KEY",
                };
                const result = await getSessionSummary(sessionKey, entries, {
                    llmModel: riskConfig.llmModel,
                    llmApiKeyEnv: riskConfig.llmApiKeyEnv,
                    modelAuth: deps.modelAuth,
                    provider: deps.provider,
                    agent: deps.agent,
                    openClawConfig: deps.openClawConfig,
                });
                if (!result.ok) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: result.message, reason: result.reason }));
                    return true;
                }
                sendJson(res, result.summary);
                return true;
            }
            const sessionMatch = subPath.match(/^api\/session\/(.+)$/);
            if (sessionMatch) {
                const sessionKey = decodeURIComponent(sessionMatch[1]);
                const entries = deps.auditLogger.readEntries();
                const detail = getSessionDetail(entries, sessionKey);
                if (!detail) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Session not found" }));
                    return true;
                }
                sendJson(res, detail);
                return true;
            }
            // ── SSE stream ──────────────────────────────
            if (subPath === "api/stream") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                });
                const listener = (entry) => {
                    // Single readEntries scan per emit — feeds both buildEvalIndex (for
                    // LLM-adjusted risk fields) and resolveSplitKeyForEntry (for split
                    // session #N suffixes). Same scan the inline path used to do for the
                    // splitter, so this isn't new work.
                    const allEntries = deps.auditLogger.readEntries();
                    const mapped = mapEntry(entry, buildEvalIndex(allEntries), deps.guardrailStore);
                    // mapEntry doesn't know about session splitting (it's used by both
                    // bucketed list endpoints and SSE); apply the split-key override
                    // here so live consumers link to the correct sub-session.
                    if (entry.sessionKey) {
                        const splitKey = resolveSplitKeyForEntry(allEntries, entry);
                        if (splitKey)
                            mapped.sessionKey = splitKey;
                    }
                    res.write(`data: ${JSON.stringify(mapped)}\n\n`);
                };
                deps.auditLogger.on("entry", listener);
                req.on("close", () => {
                    deps.auditLogger.off("entry", listener);
                });
                return true;
            }
            // ── Static files from React SPA build ───────
            if (distDir && fs.existsSync(distDir)) {
                // Try to serve a static file from dist/
                if (subPath) {
                    const filePath = path.join(distDir, subPath);
                    // Security: ensure resolved path stays within distDir
                    const resolved = path.resolve(filePath);
                    if (resolved.startsWith(path.resolve(distDir)) &&
                        fs.existsSync(resolved) &&
                        fs.statSync(resolved).isFile()) {
                        const ext = path.extname(resolved);
                        const mime = MIME_TYPES[ext] || "application/octet-stream";
                        const content = fs.readFileSync(resolved);
                        res.writeHead(200, {
                            "Content-Type": mime,
                            "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
                        });
                        res.end(content);
                        return true;
                    }
                }
                // SPA fallback — serve index.html for all non-API, non-file routes
                const indexPath = path.join(distDir, "index.html");
                if (fs.existsSync(indexPath)) {
                    const html = fs.readFileSync(indexPath, "utf-8");
                    res.writeHead(200, {
                        "Content-Type": "text/html; charset=utf-8",
                        "Cache-Control": "no-cache",
                    });
                    res.end(html);
                    return true;
                }
            }
            // ── Fallback: v1 HTML dashboard ─────────────
            if (subPath === "") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(getDashboardHtml());
                return true;
            }
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return true;
        },
    });
    api.logger.info("ClawLens: Dashboard routes registered at /plugins/clawlens");
}
function sendJson(res, data) {
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(data));
}
function clampInt(raw, min, max, fallback) {
    if (raw === null)
        return fallback;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n))
        return fallback;
    return Math.max(min, Math.min(max, n));
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
            }
            catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });
}
//# sourceMappingURL=routes.js.map