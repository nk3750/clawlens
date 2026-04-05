import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  generateMockEntries,
  generateMockAgents,
  generateMockStats,
  generateMockSessions,
} from "./mock-data";

/** Vite plugin that mocks the ClawLens API during local development. */
function mockApiPlugin(): Plugin {
  const entries = generateMockEntries();

  return {
    name: "clawlens-mock-api",
    configureServer(server) {
      // Intercept API requests before Vite handles them
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        const path = url.pathname;

        // Only handle API routes under the base path
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

        // GET /api/entries
        if (apiPath === "entries") {
          const limit = parseInt(url.searchParams.get("limit") || "50");
          const offset = parseInt(url.searchParams.get("offset") || "0");
          const sliced = entries.slice(offset, offset + limit);
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
          res.end(
            JSON.stringify({
              agent,
              recentActivity: agentEntries.slice(0, 20),
              sessions: sessions.slice(0, 10),
              totalSessions: sessions.length,
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

        // GET /api/stream (SSE) — send a new mock entry every 3-8 seconds
        if (apiPath === "stream") {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Connection", "keep-alive");

          const interval = setInterval(() => {
            const entry =
              entries[Math.floor(Math.random() * entries.length)];
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

        // Unknown API route
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
