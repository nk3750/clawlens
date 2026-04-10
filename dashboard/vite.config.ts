import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  generateMockEntries,
  generateMockAgents,
  generateMockStats,
  generateMockSessions,
  generateRiskTrend,
} from "./mock-data";

/** Vite plugin that mocks the ClawLens API during local development. */
function mockApiPlugin(): Plugin {
  const entries = generateMockEntries();

  return {
    name: "clawlens-mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        const path = url.pathname;

        if (!path.startsWith("/plugins/clawlens/api/")) {
          return next();
        }

        const apiPath = path.replace("/plugins/clawlens/api/", "");

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-cache");

        // GET /api/stats
        if (apiPath === "stats") {
          res.end(JSON.stringify(generateMockStats(entries)));
          return;
        }

        // GET /api/entries (with full filter support)
        if (apiPath === "entries") {
          const limit = parseInt(url.searchParams.get("limit") || "50");
          const offset = parseInt(url.searchParams.get("offset") || "0");
          const agentFilter = url.searchParams.get("agent");
          const categoryFilter = url.searchParams.get("category");
          const riskTierFilter = url.searchParams.get("riskTier");
          const decisionFilter = url.searchParams.get("decision");
          const sinceFilter = url.searchParams.get("since");

          let filtered = entries;

          if (agentFilter) {
            filtered = filtered.filter((e) => e.agentId === agentFilter);
          }
          if (categoryFilter) {
            filtered = filtered.filter((e) => e.category === categoryFilter);
          }
          if (riskTierFilter) {
            filtered = filtered.filter((e) => e.riskTier === riskTierFilter);
          }
          if (decisionFilter) {
            filtered = filtered.filter((e) => {
              const eff = e.effectiveDecision;
              if (decisionFilter === "block") return eff === "block" || eff === "denied";
              return eff === decisionFilter;
            });
          }
          if (sinceFilter) {
            const ms: Record<string, number> = {
              "1h": 60 * 60_000,
              "6h": 6 * 60 * 60_000,
              "24h": 24 * 60 * 60_000,
              "7d": 7 * 24 * 60 * 60_000,
            };
            const cutoff = ms[sinceFilter];
            if (cutoff) {
              const since = Date.now() - cutoff;
              filtered = filtered.filter(
                (e) => new Date(e.timestamp).getTime() >= since,
              );
            }
          }

          const sliced = filtered.slice(offset, offset + limit);
          res.end(JSON.stringify(sliced));
          return;
        }

        // GET /api/agents
        if (apiPath === "agents") {
          res.end(JSON.stringify(generateMockAgents(entries)));
          return;
        }

        // GET /api/agent/:agentId
        const agentMatch = apiPath.match(/^agent\/([^/]+)$/);
        if (agentMatch) {
          const agentId = decodeURIComponent(agentMatch[1]);
          const agents = generateMockAgents(entries);
          const agent = agents.find((a) => a.id === agentId);
          if (!agent) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Agent not found" }));
            return;
          }
          const agentEntries = entries.filter((e) => e.agentId === agentId);
          const sessions = generateMockSessions(entries, agentId);
          const riskTrend = generateRiskTrend(entries, agentId);
          // Current session activity (entries matching the agent's current session key)
          const currentSessionKey = agent.currentSession?.sessionKey;
          const currentSessionActivity = currentSessionKey
            ? agentEntries.filter((e) => e.sessionKey === currentSessionKey)
            : [];
          res.end(
            JSON.stringify({
              agent,
              currentSessionActivity,
              recentActivity: agentEntries.slice(0, 20),
              sessions: sessions.slice(0, 10),
              totalSessions: sessions.length,
              riskTrend,
            }),
          );
          return;
        }

        // GET /api/sessions
        if (apiPath === "sessions") {
          const agentId = url.searchParams.get("agentId") || undefined;
          const limit = parseInt(url.searchParams.get("limit") || "10");
          const offset = parseInt(url.searchParams.get("offset") || "0");
          const all = generateMockSessions(entries, agentId);
          res.end(
            JSON.stringify({
              sessions: all.slice(offset, offset + limit),
              total: all.length,
            }),
          );
          return;
        }

        // GET /api/session/:sessionKey
        const sessionMatch = apiPath.match(/^session\/(.+)$/);
        if (sessionMatch) {
          const sessionKey = decodeURIComponent(sessionMatch[1]);
          const sessionEntries = entries.filter(
            (e) => e.sessionKey === sessionKey,
          );
          if (sessionEntries.length === 0) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Session not found" }));
            return;
          }
          const sessions = generateMockSessions(entries);
          const session = sessions.find((s) => s.sessionKey === sessionKey);
          const sorted = [...sessionEntries].sort((a, b) =>
            a.timestamp.localeCompare(b.timestamp),
          );
          res.end(JSON.stringify({ session, entries: sorted }));
          return;
        }

        // GET /api/interventions
        if (apiPath === "interventions") {
          const interventions = entries
            .filter((e) => e.effectiveDecision === "block" || e.effectiveDecision === "denied" || e.decision === "approval_required")
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            .slice(0, 20)
            .map((e) => ({
              timestamp: e.timestamp,
              agentId: e.agentId ?? "unknown",
              agentName: e.agentId ?? "unknown",
              toolName: e.toolName,
              description: e.toolName === "exec" ? `Ran ${(e.params as Record<string, unknown>).command ?? "command"}` : e.toolName,
              riskScore: e.riskScore ?? 0,
              riskTier: e.riskTier ?? "low",
              decision: e.decision ?? "block",
              effectiveDecision: e.effectiveDecision,
              sessionKey: e.sessionKey,
            }));
          res.end(JSON.stringify(interventions));
          return;
        }

        // GET /api/health
        if (apiPath === "health") {
          res.end(
            JSON.stringify({
              valid: true,
              totalEntries: entries.length,
            }),
          );
          return;
        }

        // GET /api/stream (SSE)
        if (apiPath === "stream") {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Connection", "keep-alive");

          const interval = setInterval(() => {
            const entry = entries[Math.floor(Math.random() * entries.length)];
            const fresh = {
              ...entry,
              timestamp: new Date().toISOString(),
              toolCallId: `tc_${Math.random().toString(36).slice(2, 10)}`,
            };
            res.write(`data: ${JSON.stringify(fresh)}\n\n`);
          }, 3000 + Math.random() * 5000);

          req.on("close", () => clearInterval(interval));
          return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not found" }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mockApiPlugin()],
  base: "/plugins/clawlens/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
