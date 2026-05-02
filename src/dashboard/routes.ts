import * as fs from "node:fs";
import type { ServerResponse } from "node:http";
import * as path from "node:path";
import type { AuditEntry, AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import { GuardrailStore } from "../guardrails/store";
import {
  type Action,
  type Guardrail,
  isValidAction,
  isValidSelector,
  isValidTarget,
  type NewGuardrail,
  type Selector,
} from "../guardrails/types";
import type { PendingApprovalStore } from "../hooks/pending-approval-store";
import type { SavedSearchesStore, SavedSearchFilters } from "../risk/saved-searches-store";
import type { EmbeddedAgentRuntime, ModelAuth, OpenClawPluginApi } from "../types";
import {
  buildEvalIndex,
  checkHealth,
  computeEnhancedStats,
  computeFleetRiskIndex,
  type EntryFilters,
  getActivityTimeline,
  getAgentDetail,
  getAgents,
  getAttention,
  getFleetActivity,
  getInterventions,
  getRecentEntries,
  getSessionDetail,
  getSessions,
  localDateOf,
  localToday,
  mapEntry,
  resolveSplitKeyForEntry,
} from "./api";
import { type AckScope, AttentionStore, isValidAckScope } from "./attention-state";
import { type ActivityCategory, describeRule, KNOWN_TOOL_NAMES } from "./categories";
import { getDashboardHtml } from "./html";
import { getSessionSummary } from "./session-summary";

export interface DashboardDeps {
  auditLogger: AuditLogger;
  pluginDir?: string;
  config?: ClawLensConfig;
  modelAuth?: ModelAuth;
  provider?: string;
  agent?: EmbeddedAgentRuntime;
  openClawConfig?: Record<string, unknown>;
  guardrailStore?: GuardrailStore;
  attentionStore?: AttentionStore;
  pendingApprovalStore?: PendingApprovalStore;
  savedSearchesStore?: SavedSearchesStore;
}

const MIME_TYPES: Record<string, string> = {
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

export function registerDashboardRoutes(api: OpenClawPluginApi, deps: DashboardDeps): void {
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
        const body = (await readBody(req)) as Record<string, unknown>;
        const validation = validateNewGuardrail(body);
        if (!validation.ok) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: validation.error, field: validation.field }));
          return true;
        }

        const { selector, target, action, source, riskScore, note, description, warnings } =
          validation;

        // Idempotency: same (selector, target) returns the existing rule
        // untouched (action/note differences are deliberately ignored —
        // operators who want to change action edit the existing row).
        const existing = deps.guardrailStore.findEquivalent({ selector, target });
        if (existing) {
          sendJson(res, {
            ...existing,
            warnings: warnings.length > 0 ? warnings : undefined,
            existing: true,
          });
          return true;
        }

        const generated = description ?? describeRule({ selector, target, action });
        const guardrail: Guardrail = {
          id: GuardrailStore.generateId(),
          selector,
          target,
          action,
          ...(note !== undefined ? { note } : {}),
          description: generated,
          createdAt: new Date().toISOString(),
          source,
          riskScore,
        };
        try {
          deps.guardrailStore.add(guardrail);
          sendJson(res, {
            ...guardrail,
            warnings: warnings.length > 0 ? warnings : undefined,
            existing: false,
          });
        } catch (err) {
          handleStorageError(res, err);
        }
        return true;
      }

      if (subPath === "api/guardrails" && req.method === "GET") {
        if (!deps.guardrailStore) {
          sendJson(res, { guardrails: [] });
          return true;
        }
        const agentId = url.searchParams.get("agentId") || undefined;
        const rules = deps.guardrailStore.list(agentId ? { agentId } : undefined);
        const auditEntries = deps.auditLogger.readEntries();
        const enriched = rules.map((rule) => enrichRule(rule, auditEntries));
        sendJson(res, { guardrails: enriched });
        return true;
      }

      // /:id/stats and /:id/firings — checked BEFORE the bare /:id pattern
      // so the more specific suffix wins.
      const guardrailStatsMatch = subPath.match(/^api\/guardrails\/([^/]+)\/stats$/);
      if (guardrailStatsMatch && req.method === "GET") {
        if (!deps.guardrailStore) {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Guardrails not configured" }));
          return true;
        }
        const id = decodeURIComponent(guardrailStatsMatch[1]);
        const rule = deps.guardrailStore.list().find((g) => g.id === id);
        if (!rule) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Guardrail not found" }));
          return true;
        }
        const auditEntries = deps.auditLogger.readEntries();
        const stats = computeRuleStats(id, auditEntries);
        sendJson(res, { id, ...stats });
        return true;
      }

      const guardrailFiringsMatch = subPath.match(/^api\/guardrails\/([^/]+)\/firings$/);
      if (guardrailFiringsMatch && req.method === "GET") {
        if (!deps.guardrailStore) {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Guardrails not configured" }));
          return true;
        }
        const id = decodeURIComponent(guardrailFiringsMatch[1]);
        const rule = deps.guardrailStore.list().find((g) => g.id === id);
        if (!rule) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Guardrail not found" }));
          return true;
        }
        const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
        const auditEntries = deps.auditLogger.readEntries();
        sendJson(res, { firings: computeRuleFirings(id, auditEntries, limit) });
        return true;
      }

      const guardrailIdMatch = subPath.match(/^api\/guardrails\/([^/]+)$/);
      if (guardrailIdMatch && req.method === "PATCH") {
        if (!deps.guardrailStore) {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Guardrails not configured" }));
          return true;
        }
        const id = decodeURIComponent(guardrailIdMatch[1]);
        const body = (await readBody(req)) as Record<string, unknown>;
        // Phase 2: scoped allowlist for tools.values + target.pattern.
        // tools.mode and target.kind remain immutable — they define rule
        // identity for idempotency. Operators delete + recreate to change
        // those discriminators.
        const existingRule = deps.guardrailStore.list().find((g) => g.id === id);
        if (!existingRule) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Guardrail not found" }));
          return true;
        }
        const tools = body.tools as Record<string, unknown> | undefined;
        const target = body.target as Record<string, unknown> | undefined;

        if (target?.kind !== undefined) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "target.kind is immutable; delete and recreate" }));
          return true;
        }
        if (tools?.mode !== undefined) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "selector.tools.mode is immutable; delete and recreate" }),
          );
          return true;
        }

        let toolsValues: string[] | undefined;
        const warnings: string[] = [];
        if (tools?.values !== undefined) {
          if (existingRule.selector.tools.mode !== "names") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "selector.tools.values editable only on names-mode rules",
              }),
            );
            return true;
          }
          if (!Array.isArray(tools.values) || tools.values.length === 0) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "selector.tools.values must be a non-empty string array" }),
            );
            return true;
          }
          if (!tools.values.every((v) => typeof v === "string" && v.length > 0)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "selector.tools.values entries must be non-empty strings" }),
            );
            return true;
          }
          // Dedupe + warn on duplicates and unknown tool names — same templates
          // POST emits at routes.ts:870-883 (#47 mitigation parity).
          const seen = new Set<string>();
          const dedup: string[] = [];
          for (const v of tools.values as string[]) {
            if (seen.has(v)) {
              warnings.push(`removed duplicate tool name '${v}' from values`);
              continue;
            }
            seen.add(v);
            dedup.push(v);
          }
          for (const name of dedup) {
            if (!KNOWN_TOOL_NAMES.has(name)) {
              warnings.push(
                `unknown tool name '${name}' — rule will not fire until ClawLens recognizes this tool`,
              );
            }
          }
          toolsValues = dedup;
        }

        let targetPattern: string | undefined;
        if (target?.pattern !== undefined) {
          if (typeof target.pattern !== "string" || target.pattern.length === 0) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "target.pattern must be a non-empty string" }));
            return true;
          }
          targetPattern = target.pattern;
        }

        if (body.action !== undefined && !isValidAction(body.action)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid action" }));
          return true;
        }
        if (body.note !== undefined && typeof body.note !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "note must be a string" }));
          return true;
        }
        if (body.agent !== undefined && body.agent !== null && typeof body.agent !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "agent must be a string or null" }));
          return true;
        }
        try {
          const updated = deps.guardrailStore.update(id, {
            action: body.action as Action | undefined,
            note: body.note as string | undefined,
            agent: body.agent as string | null | undefined,
            toolsValues,
            targetPattern,
          });
          if (!updated) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Guardrail not found" }));
            return true;
          }
          const auditEntries = deps.auditLogger.readEntries();
          const enriched = enrichRule(updated, auditEntries);
          sendJson(res, warnings.length > 0 ? { ...enriched, warnings } : enriched);
        } catch (err) {
          handleStorageError(res, err);
        }
        return true;
      }

      if (guardrailIdMatch && req.method === "DELETE") {
        if (!deps.guardrailStore) {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Guardrails not configured" }));
          return true;
        }
        const id = decodeURIComponent(guardrailIdMatch[1]);
        try {
          const removed = deps.guardrailStore.remove(id);
          if (!removed) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Guardrail not found" }));
            return true;
          }
          sendJson(res, { ok: true });
        } catch (err) {
          handleStorageError(res, err);
        }
        return true;
      }

      // ── Saved searches CRUD (Phase 2.8, #36) ────
      // Backend persistence for the rail's saved-searches group. The
      // frontend's hook migrates localStorage entries into here on first
      // load and then sources from this endpoint thereafter.

      if (subPath === "api/saved-searches" && req.method === "GET") {
        if (!deps.savedSearchesStore) {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Saved searches not configured" }));
          return true;
        }
        sendJson(res, { items: deps.savedSearchesStore.list() });
        return true;
      }

      if (subPath === "api/saved-searches" && req.method === "POST") {
        if (!deps.savedSearchesStore) {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Saved searches not configured" }));
          return true;
        }
        const body = (await readBody(req)) as { name?: unknown; filters?: unknown };
        const nameError = validateSavedSearchName(body.name);
        if (nameError) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: nameError }));
          return true;
        }
        const filters = sanitizeSavedSearchFilters(body.filters);
        try {
          const item = deps.savedSearchesStore.add((body.name as string).trim(), filters);
          sendJson(res, { item });
        } catch (err) {
          handleStorageError(res, err);
        }
        return true;
      }

      const savedSearchIdMatch = subPath.match(/^api\/saved-searches\/([^/]+)$/);
      if (savedSearchIdMatch && req.method === "DELETE") {
        if (!deps.savedSearchesStore) {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Saved searches not configured" }));
          return true;
        }
        const id = decodeURIComponent(savedSearchIdMatch[1]);
        try {
          const removed = deps.savedSearchesStore.remove(id);
          if (!removed) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Saved search not found" }));
            return true;
          }
          sendJson(res, { ok: true });
        } catch (err) {
          handleStorageError(res, err);
        }
        return true;
      }

      if (savedSearchIdMatch && req.method === "PATCH") {
        if (!deps.savedSearchesStore) {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Saved searches not configured" }));
          return true;
        }
        const id = decodeURIComponent(savedSearchIdMatch[1]);
        const body = (await readBody(req)) as { name?: unknown };
        const nameError = validateSavedSearchName(body.name);
        if (nameError) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: nameError }));
          return true;
        }
        try {
          const updated = deps.savedSearchesStore.rename(id, (body.name as string).trim());
          if (!updated) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Saved search not found" }));
            return true;
          }
          sendJson(res, { item: updated });
        } catch (err) {
          handleStorageError(res, err);
        }
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
        const filters: EntryFilters = {};
        const agent = url.searchParams.get("agent");
        if (agent) filters.agent = agent;
        const category = url.searchParams.get("category");
        if (category) filters.category = category as ActivityCategory;
        const riskTier = url.searchParams.get("riskTier");
        if (riskTier) filters.riskTier = riskTier as EntryFilters["riskTier"];
        const decision = url.searchParams.get("decision");
        if (decision) filters.decision = decision;
        const since = url.searchParams.get("since");
        if (since) filters.since = since as EntryFilters["since"];
        // Phase 2.7 (#35): free-text query. The frontend's
        // <input maxLength={200}> keeps the UI honest; the 400 below is
        // defense-in-depth for direct URL manipulation.
        const q = url.searchParams.get("q");
        if (q) {
          if (q.length > 200) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "q exceeds 200 char limit" }));
            return true;
          }
          filters.q = q;
        }

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
        const body = (await readBody(req)) as {
          scope?: unknown;
          note?: unknown;
          ackedBy?: unknown;
        };
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
          scope: body.scope as AckScope,
          ackedAt: new Date().toISOString(),
          ackedBy: typeof body.ackedBy === "string" ? body.ackedBy : undefined,
          action: "ack" as const,
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
        const body = (await readBody(req)) as {
          toolCallId?: unknown;
          decision?: unknown;
          note?: unknown;
        };
        if (
          typeof body.toolCallId !== "string" ||
          body.toolCallId.length === 0 ||
          (body.decision !== "approve" && body.decision !== "deny")
        ) {
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
        } catch (err) {
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
        const avgRiskTier = parseSessionRiskTier(url.searchParams.get("risk"));
        const durationBucket = parseSessionDurationBucket(url.searchParams.get("duration"));
        const since = parseSessionSince(url.searchParams.get("since"));
        const limit = clampInt(url.searchParams.get("limit"), 1, 100, 25);
        const offset = clampInt(url.searchParams.get("offset"), 0, Infinity, 0);
        const entries = deps.auditLogger.readEntries();
        sendJson(
          res,
          getSessions(entries, { agentId, avgRiskTier, durationBucket, since }, limit, offset),
        );
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

        const listener = (entry: AuditEntry) => {
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
            if (splitKey) mapped.sessionKey = splitKey;
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
          if (
            resolved.startsWith(path.resolve(distDir)) &&
            fs.existsSync(resolved) &&
            fs.statSync(resolved).isFile()
          ) {
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

function sendJson(res: ServerResponse, data: unknown): void {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(data));
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseSessionRiskTier(
  raw: string | null,
): "low" | "medium" | "high" | "critical" | undefined {
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "critical") return raw;
  return undefined;
}

function parseSessionDurationBucket(raw: string | null): "lt1m" | "1to10m" | "gt10m" | undefined {
  if (raw === "lt1m" || raw === "1to10m" || raw === "gt10m") return raw;
  return undefined;
}

function parseSessionSince(raw: string | null): "1h" | "6h" | "24h" | "7d" | undefined {
  if (raw === "1h" || raw === "6h" || raw === "24h" || raw === "7d") return raw;
  return undefined;
}

/**
 * Validate a POST/PATCH body's `name` field for the saved-searches endpoints.
 * Returns an error message string, or null if valid. The 100-char cap is
 * defense-in-depth — operators don't need 10KB names, attackers shouldn't be
 * able to fill the file with one.
 */
function validateSavedSearchName(name: unknown): string | null {
  if (typeof name !== "string") return "name is required";
  if (name.trim().length === 0) return "name cannot be empty";
  if (name.length > 100) return "name exceeds 100 char limit";
  return null;
}

/**
 * Whitelist + type-check the filter shape so the persisted file can never
 * grow keys/values the frontend won't recognize on read. Mirrors
 * dashboard/src/lib/activityFilters.ts::Filters; values must be strings.
 */
function sanitizeSavedSearchFilters(input: unknown): SavedSearchFilters {
  if (!input || typeof input !== "object") return {};
  const f = input as Record<string, unknown>;
  const out: SavedSearchFilters = {};
  if (typeof f.agent === "string") out.agent = f.agent;
  if (typeof f.category === "string") out.category = f.category;
  if (typeof f.tier === "string") out.tier = f.tier;
  if (typeof f.decision === "string") out.decision = f.decision;
  if (typeof f.since === "string") out.since = f.since;
  if (typeof f.q === "string") out.q = f.q;
  return out;
}

/**
 * Map a thrown filesystem error from a store .save() into an HTTP response.
 * Disk-shaped errors (ENOSPC, EISDIR, EROFS, EDQUOT) → 507 so the operator
 * can distinguish "out of room" from a generic 500. Anything else → 500.
 */
function handleStorageError(res: ServerResponse, err: unknown): void {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "unknown error";
  if (code === "ENOSPC" || code === "EISDIR" || code === "EROFS" || code === "EDQUOT") {
    res.writeHead(507, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "disk full or unwritable", code, message }));
    return;
  }
  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "internal storage error", code, message }));
}

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// ── Guardrail POST validation ──────────────────────────────

type ValidationOk = {
  ok: true;
  selector: NewGuardrail["selector"];
  target: NewGuardrail["target"];
  action: NewGuardrail["action"];
  source: NewGuardrail["source"];
  riskScore: number;
  note?: string;
  description?: string;
  warnings: string[];
};
type ValidationErr = { ok: false; error: string; field: string };
type Validation = ValidationOk | ValidationErr;

/**
 * Validate POST /api/guardrails body. Empty target patterns / empty
 * tools.values / unknown ActivityCategory / invalid action are 400s.
 * Unknown tool names are accepted with a warning (#47 mitigation —
 * operators may pre-create rules for tools ClawLens hasn't audited yet).
 */
function validateNewGuardrail(body: Record<string, unknown>): Validation {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be an object", field: "" };
  }
  if (!isValidSelector(body.selector)) {
    return { ok: false, error: "invalid selector", field: "selector" };
  }
  if (!isValidTarget(body.target)) {
    return { ok: false, error: "invalid target", field: "target" };
  }
  if (!isValidAction(body.action)) {
    return { ok: false, error: "invalid action", field: "action" };
  }
  const source = body.source as Record<string, unknown> | undefined;
  if (
    !source ||
    typeof source !== "object" ||
    typeof source.toolCallId !== "string" ||
    typeof source.sessionKey !== "string" ||
    typeof source.agentId !== "string"
  ) {
    return { ok: false, error: "source is required", field: "source" };
  }
  const riskScore = typeof body.riskScore === "number" ? body.riskScore : 0;

  // Names mode: dedupe + warn on unknowns.
  const warnings: string[] = [];
  let selector = body.selector as Selector;
  if (selector.tools.mode === "names") {
    const original = selector.tools.values;
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const v of original) {
      if (seen.has(v)) {
        warnings.push(`removed duplicate tool name '${v}' from values`);
        continue;
      }
      seen.add(v);
      dedup.push(v);
    }
    for (const name of dedup) {
      if (!KNOWN_TOOL_NAMES.has(name)) {
        warnings.push(
          `unknown tool name '${name}' — rule will not fire until ClawLens recognizes this tool`,
        );
      }
    }
    selector = { ...selector, tools: { mode: "names", values: dedup } };
  }

  return {
    ok: true,
    selector,
    target: body.target as NewGuardrail["target"],
    action: body.action as Action,
    source: {
      toolCallId: source.toolCallId,
      sessionKey: source.sessionKey,
      agentId: source.agentId,
    },
    riskScore,
    note: typeof body.note === "string" ? body.note : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    warnings,
  };
}

// ── Guardrail enrichment + audit-log derived stats ──────────

const RULE_HITS_24H_MS = 24 * 3600_000;
const RULE_HITS_7D_MS = 7 * 86400_000;

function isGuardrailMatchEntry(e: AuditEntry): boolean {
  return typeof e.params?.guardrailId === "string";
}

/** Wrap a rule with hits24h, hits7d, lastFiredAt computed from audit log. */
function enrichRule(
  rule: Guardrail,
  entries: AuditEntry[],
): Guardrail & { hits24h: number; hits7d: number; lastFiredAt: string | null } {
  const now = Date.now();
  let hits24h = 0;
  let hits7d = 0;
  let lastFiredAt: string | null = null;
  for (const e of entries) {
    if (!isGuardrailMatchEntry(e)) continue;
    if (e.params.guardrailId !== rule.id) continue;
    const age = now - new Date(e.timestamp).getTime();
    if (age <= RULE_HITS_7D_MS) hits7d++;
    if (age <= RULE_HITS_24H_MS) hits24h++;
    if (lastFiredAt === null || e.timestamp > lastFiredAt) {
      lastFiredAt = e.timestamp;
    }
  }
  return { ...rule, hits24h, hits7d, lastFiredAt };
}

/** /api/guardrails/:id/stats — hits24h + lastFiredAt + 24-bucket sparkline. */
function computeRuleStats(
  id: string,
  entries: AuditEntry[],
): { hits24h: number; lastFiredAt: string | null; sparkline: number[] } {
  const now = Date.now();
  const sparkline = new Array<number>(24).fill(0);
  let hits24h = 0;
  let lastFiredAt: string | null = null;
  for (const e of entries) {
    if (!isGuardrailMatchEntry(e)) continue;
    if (e.params.guardrailId !== id) continue;
    const t = new Date(e.timestamp).getTime();
    const age = now - t;
    if (age > RULE_HITS_24H_MS || age < 0) continue;
    hits24h++;
    // Bucket index: 0 = oldest hour (23-24h ago), 23 = most recent hour.
    const hoursAgo = Math.floor(age / 3600_000);
    const bucket = 23 - Math.min(23, hoursAgo);
    sparkline[bucket]++;
    if (lastFiredAt === null || e.timestamp > lastFiredAt) {
      lastFiredAt = e.timestamp;
    }
  }
  return { hits24h, lastFiredAt, sparkline };
}

/** /api/guardrails/:id/firings — recent guardrail_match rows joined to
 *  their guardrail_resolution follow-ups. allow_notify firings have no
 *  resolution (the action allows the call through). */
function computeRuleFirings(
  id: string,
  entries: AuditEntry[],
  limit: number,
): Array<{
  at: string;
  toolName: string;
  agentId: string;
  sessionKey?: string;
  resolution: "approved" | "denied" | "pending" | "allow_notify";
}> {
  // Index resolution rows by toolCallId for O(1) join.
  const resolutions = new Map<string, "approved" | "denied">();
  for (const e of entries) {
    const params = e.params as Record<string, unknown>;
    if (
      typeof params?.guardrailId === "string" &&
      params.guardrailId === id &&
      typeof params.resolution === "string" &&
      e.toolCallId
    ) {
      resolutions.set(e.toolCallId, e.userResponse === "approved" ? "approved" : "denied");
    }
  }

  const firings: Array<{
    at: string;
    toolName: string;
    agentId: string;
    sessionKey?: string;
    resolution: "approved" | "denied" | "pending" | "allow_notify";
  }> = [];
  for (const e of entries) {
    if (!isGuardrailMatchEntry(e)) continue;
    if (e.params.guardrailId !== id) continue;
    const params = e.params as Record<string, unknown>;
    // Skip resolution rows — they ALSO carry guardrailId but represent the
    // follow-up, not the firing itself. Distinguish by presence of the
    // 'resolution' field on the params record.
    if (typeof params.resolution === "string") continue;
    const action = typeof params.guardrailAction === "string" ? params.guardrailAction : "block";
    let resolution: "approved" | "denied" | "pending" | "allow_notify";
    if (action === "allow_notify") {
      resolution = "allow_notify";
    } else if (action === "block") {
      resolution = "denied";
    } else {
      // require_approval: look up the resolution row
      const found = e.toolCallId ? resolutions.get(e.toolCallId) : undefined;
      resolution = found ?? "pending";
    }
    firings.push({
      at: e.timestamp,
      toolName: e.toolName,
      agentId: e.agentId ?? "",
      sessionKey: e.sessionKey,
      resolution,
    });
  }
  // Newest first.
  firings.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return firings.slice(0, limit);
}
