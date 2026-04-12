import * as fs from "node:fs";
import type { ServerResponse } from "node:http";
import * as path from "node:path";
import type { AuditEntry, AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import { extractIdentityKey } from "../guardrails/identity";
import { GuardrailStore } from "../guardrails/store";
import { type GuardrailAction, isValidGuardrailAction } from "../guardrails/types";
import type { EmbeddedAgentRuntime, ModelAuth, OpenClawPluginApi } from "../types";
import {
  checkHealth,
  computeEnhancedStats,
  DEFAULT_AGENT_ID,
  type EntryFilters,
  getActivityTimeline,
  getAgentDetail,
  getAgents,
  getInterventions,
  getRecentEntries,
  getSessionDetail,
  getSessions,
} from "./api";
import type { ActivityCategory } from "./categories";
import { getCategory } from "./categories";
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
        const body = await readBody(req);
        const { toolCallId, action, agentScope } = body as {
          toolCallId: string;
          action: GuardrailAction;
          agentScope: "agent" | "global";
        };
        if (!toolCallId || !action) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "toolCallId and action are required" }));
          return true;
        }
        if (!isValidGuardrailAction(action)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Invalid action. Must be block or require_approval",
            }),
          );
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
        const describeAction = (tn: string, p: Record<string, unknown>) => {
          const val =
            typeof p.command === "string"
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
          matchMode: "exact" as const,
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
        sendJson(res, guardrail);
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
        const patch = body as {
          action?: GuardrailAction;
          agentId?: string | null;
        };
        if (patch.action !== undefined && !isValidGuardrailAction(patch.action)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Invalid action. Must be block or require_approval",
            }),
          );
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

      if (subPath === "api/health") {
        const entries = deps.auditLogger.readEntries();
        sendJson(res, checkHealth(entries));
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
        sendJson(res, getInterventions(entries, date));
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
        const summary = await getSessionSummary(sessionKey, entries, {
          llmModel: riskConfig.llmModel,
          llmApiKeyEnv: riskConfig.llmApiKeyEnv,
          modelAuth: deps.modelAuth,
          provider: deps.provider,
          agent: deps.agent,
          openClawConfig: deps.openClawConfig,
        });
        if (!summary) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return true;
        }
        sendJson(res, summary);
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
          const enriched: Record<string, unknown> = {
            ...entry,
            category: getCategory(entry.toolName),
          };
          if (deps.guardrailStore && entry.decision) {
            const key = extractIdentityKey(entry.toolName, entry.params);
            const matched = deps.guardrailStore.peek(
              entry.agentId || DEFAULT_AGENT_ID,
              entry.toolName,
              key,
            );
            if (matched) {
              enriched.guardrailMatch = { id: matched.id, action: matched.action };
            }
          }
          res.write(`data: ${JSON.stringify(enriched)}\n\n`);
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
