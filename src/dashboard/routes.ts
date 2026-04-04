import type { ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "../types";
import type { AuditLogger } from "../audit/logger";
import type { PolicyEngine } from "../policy/engine";
import { computeStats, getRecentEntries, checkHealth } from "./api";
import { getDashboardHtml } from "./html";

export interface DashboardDeps {
  engine: PolicyEngine;
  auditLogger: AuditLogger;
}

export function registerDashboardRoutes(
  api: OpenClawPluginApi,
  deps: DashboardDeps,
): void {
  api.registerHttpRoute({
    path: "/plugins/clawlens",
    auth: "plugin",
    match: "prefix",
    replaceExisting: true,
    handler: async (req, res) => {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`,
      );

      // Strip the route prefix to get the sub-path
      let subPath = url.pathname;
      if (subPath.startsWith("/plugins/clawlens")) {
        subPath = subPath.slice("/plugins/clawlens".length);
      }
      subPath = subPath.replace(/^\//, "");

      // HTML dashboard
      if (subPath === "") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getDashboardHtml());
        return true;
      }

      // API: today's stats
      if (subPath === "api/stats") {
        const entries = deps.auditLogger.readEntries();
        sendJson(res, computeStats(entries));
        return true;
      }

      // API: paginated entries
      if (subPath === "api/entries") {
        const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
        const offset = clampInt(url.searchParams.get("offset"), 0, Infinity, 0);
        const entries = deps.auditLogger.readEntries();
        sendJson(res, getRecentEntries(entries, limit, offset));
        return true;
      }

      // API: hash chain health
      if (subPath === "api/health") {
        const entries = deps.auditLogger.readEntries();
        sendJson(res, checkHealth(entries));
        return true;
      }

      // Unknown sub-path
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

function clampInt(
  raw: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
