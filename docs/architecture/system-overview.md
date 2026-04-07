# ClawLens System Overview

## Component Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway (port 18789)                   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Built-in Security                                          │ │
│  │  Exec approvals (shell)  │  Tool profiles (minimal→full)   │ │
│  │  Prompt injection detect │  Owner-only tool filtering       │ │
│  │  Auth rate limiting      │  Security audit CLI              │ │
│  └─────────────────────────────────────────────────────────────┘ │
│         │                                                        │
│         ▼  (actions that pass built-in checks)                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              ClawLens Plugin                                 │ │
│  │                                                             │ │
│  │  ┌──────────────────────────────────────────────────────┐   │ │
│  │  │     Hook Handlers                                     │   │ │
│  │  │  before_tool_call  (priority: 100) — core enforce    │   │ │
│  │  │  after_tool_call   — audit logging                   │   │ │
│  │  │  before_prompt_build — constraint injection          │   │ │
│  │  │  session_start/end — lifecycle management            │   │ │
│  │  └──────────┬───────────────────────────────────────────┘   │ │
│  │             │                                               │ │
│  │  ┌──────────▼───────────────────────────────────────────┐   │ │
│  │  │      Policy Engine                                    │   │ │
│  │  │                                                      │   │ │
│  │  │  YAML policies → evaluate toolName + params          │   │ │
│  │  │  against rules → allow / block / approval_required   │   │ │
│  │  └──────────┬───────────────────────────────────────────┘   │ │
│  │             │                                               │ │
│  │  ┌──────────▼───────────────────────────────────────────┐   │ │
│  │  │    Approval Manager                                   │   │ │
│  │  │                                                      │   │ │
│  │  │  Gateway method → prompt user in channel             │   │ │
│  │  │  Wait for response → approve/deny                    │   │ │
│  │  │  Timeout → default deny (configurable)               │   │ │
│  │  └──────────┬───────────────────────────────────────────┘   │ │
│  │             │                                               │ │
│  │  ┌──────────▼───────────────────────────────────────────┐   │ │
│  │  │      Audit Logger                                     │   │ │
│  │  │                                                      │   │ │
│  │  │  JSONL log of every decision + context               │   │ │
│  │  │  Structured for parseability and export              │   │ │
│  │  └──────────┬───────────────────────────────────────────┘   │ │
│  │             │                                               │ │
│  │  ┌──────────▼───────────────────────────────────────────┐   │ │
│  │  │    Digest Generator                                   │   │ │
│  │  │                                                      │   │ │
│  │  │  Daily/weekly summary of agent activity               │   │ │
│  │  │  Delivered via user's preferred channel               │   │ │
│  │  └──────────────────────────────────────────────────────┘   │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│         │                                                        │
│         ▼  (allowed actions)                                     │
│  ┌──────────┐                                                    │
│  │  Tool    │                                                    │
│  │ Execution│  ← action executes (or was blocked above)          │
│  └──────────┘                                                    │
└──────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Risk Scorer (two-tier)

Scores every tool call for risk on a 0-100 scale. The scoring hero of ClawLens.

**Tier 1 — Deterministic scoring (<5ms):**
- Exec commands parsed into 14 categories (`src/risk/exec-parser.ts`): read-only (10), scripting (40), destructive (75), etc.
- Modifier system adds/subtracts for flags, network targets, data mutation
- Non-exec tools scored by tool type (read=5, write=35, message=45, etc.)

**Tier 2 — LLM evaluation (async, cached):**
- Fires when tier-1 score >= 50 (configurable `llmEvalThreshold`)
- Uses Claude Haiku via `runtime.subagent` (gateway requests) or direct Anthropic API (cron jobs)
- Eval cache: SHA256(toolName + normalized params), 24h TTL, max 500 entries
- Pre-warmed from audit log at startup

**Files:** `src/risk/scorer.ts`, `src/risk/exec-parser.ts`, `src/risk/llm-evaluator.ts`, `src/risk/eval-cache.ts`, `src/risk/types.ts`

### 2. Hook Handlers

The entry points where ClawLens receives control from OpenClaw's plugin hook system.

**Registered hooks:**

| Hook | Priority | Purpose | Execution Mode |
|------|----------|---------|----------------|
| `before_tool_call` | 100 (high) | Core enforcement — evaluate policy, block or approve | Sequential (can block) |
| `after_tool_call` | default | Audit logging after execution | Parallel (fire-and-forget) |
| `before_prompt_build` | default | Inject policy constraints into agent context | Sequential (merges context) |
| `session_start` | default | Initialize session state, load policies | Parallel |
| `session_end` | default | Cleanup, trigger digest generation | Parallel |

**`before_tool_call` handler — the core enforcement point:**

```typescript
api.on("before_tool_call", async (event, ctx) => {
  // event: { toolName: string, params: Record<string, unknown>, runId?, toolCallId? }
  const decision = policyEngine.evaluate(event.toolName, event.params);

  if (decision === "block") {
    return { block: true, blockReason: "Blocked by ClawLens policy" };
  }
  if (decision === "approval_required") {
    const approved = await approvalManager.requestApproval(event, ctx);
    if (!approved) {
      return { block: true, blockReason: "User denied action" };
    }
  }
  // allow — return void
}, { priority: 100 });
```

Priority 100 ensures ClawLens runs early in the hook chain (higher number = runs first). Built-in exec approvals operate separately in the tool execution pipeline.

### 2. Policy Engine

Evaluates actions against user-defined YAML rules. Entirely our design.

**Responsibilities:**
- Load and parse YAML policy files
- Match incoming `toolName` + `params` against policy rules
- Return a decision: `allow`, `block`, `approval_required`
- Support rule priorities and cascading defaults

**Key design:**
- Policies are YAML — see [[policy-engine]] for schema
- Rules match on tool name (exact + wildcard), parameter patterns, rate limits
- Default policy: require approval for destructive actions, allow reads
- Hot-reload on file change

See [[policy-engine]] for full specification.

### 3. Approval Manager

Handles human-in-the-loop approval flows. Entirely our design.

**Responsibilities:**
- Send approval prompts to user via gateway methods (`clawlens.approve`, `clawlens.deny`)
- Wait for user response with configurable timeout
- Format prompts with action details in plain language
- Track pending approvals and their state
- Default to deny on timeout

**Approval prompt example:**
```
ClawLens: Approval needed

The agent wants to:
  Send an email to boss@company.com
  Subject: "Quarterly report"
  Tool: message

Reply YES to approve or NO to deny.
(Auto-denied in 5 minutes if no response)
```

### 4. Audit Logger

Records every action and decision. Entirely our design.

**Responsibilities:**
- Log every `before_tool_call` decision with full context
- Log every `after_tool_call` result (success/failure)
- Structured JSONL format (matching OpenClaw's own log format)
- Local file storage (v0.1), with export capability

**Log entry format:**
```json
{
  "timestamp": "2026-03-15T14:30:00Z",
  "toolName": "message",
  "toolCallId": "tc_abc123",
  "params": { "to": "boss@company.com", "subject": "Quarterly report" },
  "policyRule": "messaging.require_approval",
  "decision": "approval_required",
  "userResponse": "approved",
  "executionResult": "success",
  "durationMs": 1200
}
```

### 6. Dashboard (React SPA)

The primary product surface. Served via `registerHttpRoute()` on the gateway.

**Architecture:** React 18 + TypeScript + Tailwind CSS + Vite. Built to `dashboard/dist/`, served as static files. Backend API + SSE streaming in `src/dashboard/`.

**Pages:**
- **Agents** — landing page, hex constellation of agent nodes with risk posture
- **Agent Detail** — risk intelligence panel, activity profile, current session stream, past sessions
- **Session Detail** — unified timeline with risk-encoded nodes, risk lane, AI summary
- **Activity** — global feed with filtering (agent, category, risk tier, decision, time)

**API endpoints** (8 REST + 1 SSE): stats, entries (with filters), health, agents, agent detail, sessions, session detail, session summary, real-time stream.

**Files:** `src/dashboard/api.ts`, `src/dashboard/routes.ts`, `src/dashboard/categories.ts`, `src/dashboard/session-summary.ts`. Frontend in `dashboard/src/`.

### 7. Alerts + Digest

**Telegram alerts** (`src/alerts/telegram.ts`): fires on high-risk actions above configurable threshold. Includes quiet hours, cooldown, and rate limiting.

**Digest generator** (`src/audit/digest.ts`): template-based daily/weekly summaries of agent activity. Delivered via user's preferred channel.

## Data Flow: Action Through ClawLens

```
1. Agent plans action (e.g., "send email")
2. before_tool_call hook fires (sequential, by priority)
3. Built-in security has already evaluated:
   - Exec approvals (if shell command)
   - Tool profile check (is tool in agent's allowed set?)
   - Owner-only filter (if applicable)
4. ClawLens evaluates (at priority 100):
   a. Hook handler extracts toolName + params from event
   b. Policy Engine matches against YAML rules
   c. Decision:
      - ALLOW → return void, tool executes
      - BLOCK → return { block: true, blockReason: "..." }
      - APPROVAL_REQUIRED → Approval Manager sends prompt
        → User responds YES → allow (return void)
        → User responds NO → block
        → Timeout → block
5. Tool executes (if allowed)
6. after_tool_call hook fires → Audit Logger records result
7. End of session → session_end hook → Digest Generator summarizes
```

## File Structure

```
index.ts                    # Plugin entry: exports OpenClawPluginDefinition
openclaw.plugin.json        # Plugin manifest
biome.json                  # Linter/formatter config
src/
  hooks/                    # Hook handlers
    before-tool-call.ts     # Core: risk scoring + policy eval + approval
    after-tool-call.ts      # Audit logging (fire-and-forget)
    before-prompt-build.ts  # Constraint injection into agent context
    session-start.ts        # Session init, policy reload
    session-end.ts          # Cleanup, digest trigger
  risk/                     # Two-tier risk scoring
    scorer.ts               # Tier-1 deterministic scorer
    exec-parser.ts          # Exec command parser (14 categories)
    llm-evaluator.ts        # Tier-2 LLM eval (subagent + direct API)
    eval-cache.ts           # SHA256-keyed eval cache with TTL
    types.ts                # Risk types
  policy/                   # YAML policy engine
    engine.ts               # First-match-wins evaluation
    parser.ts               # YAML parser + hot-reload
    types.ts                # Policy types
  approval/                 # Human-in-the-loop
    manager.ts              # Approval flow via gateway methods
    formatter.ts            # Prompt formatting
  audit/                    # Audit trail
    logger.ts               # JSONL logger with hash chain
    digest.ts               # Activity summary generation
    exporter.ts             # Audit log export
  dashboard/                # Dashboard backend
    api.ts                  # Data aggregation (agents, sessions, stats)
    routes.ts               # HTTP routes + SSE stream
    categories.ts           # Tool -> activity category mapping
    session-summary.ts      # LLM session summaries with caching
    html.ts                 # Fallback v1 HTML dashboard
  alerts/                   # External notifications
    telegram.ts             # Telegram alert integration
  config.ts                 # Plugin config schema + defaults
  types.ts                  # OpenClaw plugin SDK types
dashboard/                  # React SPA (separate package.json)
  src/
    pages/                  # Agents, AgentDetail, SessionDetail, Activity
    components/             # UI components (timeline, risk viz, cards)
    hooks/                  # useApi, useSSE, useSessionSummary
    lib/                    # Types, utils, groupEntries
tests/                      # Vitest tests
policies/                   # Default + example YAML policies
docs/                       # Obsidian vault (specs, ADRs, architecture)
```

## See Also

- [[clawlens-hook-strategy]] — detailed hook mapping with all 24 hooks
- [[policy-engine]] — YAML policy schema and examples
- [[openclaw-plugin-system]] — OpenClaw plugin API and hook system
- [[openclaw-security]] — built-in security components we complement
- [[product/mvp-scope]] — what's in v0.1 vs later
