# ClawClip System Overview

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
│  │              ClawClip Plugin                                 │ │
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

### 1. Hook Handlers

The entry points where ClawClip receives control from OpenClaw's plugin hook system.

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
    return { block: true, blockReason: "Blocked by ClawClip policy" };
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

Priority 100 ensures ClawClip runs early in the hook chain (higher number = runs first). Built-in exec approvals operate separately in the tool execution pipeline.

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
- Send approval prompts to user via gateway methods (`clawclip.approve`, `clawclip.deny`)
- Wait for user response with configurable timeout
- Format prompts with action details in plain language
- Track pending approvals and their state
- Default to deny on timeout

**Approval prompt example:**
```
ClawClip: Approval needed

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

### 5. Digest Generator

Creates human-readable summaries. Entirely our design.

**Responsibilities:**
- Aggregate audit log entries over a time window
- Generate plain-language summary of agent activity
- Highlight blocked actions, approved actions, anomalies
- Deliver via the user's preferred channel

**v0.1:** Template-based digest via audit log aggregation. v0.2: LLM-generated natural language summaries.

## Data Flow: Action Through ClawClip

```
1. Agent plans action (e.g., "send email")
2. before_tool_call hook fires (sequential, by priority)
3. Built-in security has already evaluated:
   - Exec approvals (if shell command)
   - Tool profile check (is tool in agent's allowed set?)
   - Owner-only filter (if applicable)
4. ClawClip evaluates (at priority 100):
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

## File Structure (ClawClip Plugin)

Following real OpenClaw plugin conventions (based on `extensions/voice-call/` and others):

```
clawclip/
├── openclaw.plugin.json     # Plugin manifest (JSON)
├── index.ts                 # Entry: exports OpenClawPluginDefinition
├── package.json             # Dependencies, scripts
├── tsconfig.json            # TypeScript config
├── src/
│   ├── hooks/
│   │   ├── before-tool-call.ts   # Core enforcement (before_tool_call)
│   │   ├── after-tool-call.ts    # Audit logging (after_tool_call)
│   │   ├── before-prompt-build.ts # Constraint injection
│   │   ├── session-start.ts      # Session initialization
│   │   └── session-end.ts        # Cleanup, digest trigger
│   ├── policy/
│   │   ├── engine.ts             # Policy evaluation logic
│   │   ├── parser.ts             # YAML policy parser
│   │   └── types.ts              # Policy types
│   ├── approval/
│   │   ├── manager.ts            # Approval flow via gateway methods
│   │   └── formatter.ts          # Prompt formatting
│   ├── audit/
│   │   ├── logger.ts             # Structured JSONL audit log
│   │   └── digest.ts             # Activity summary generation
│   └── config.ts                 # Plugin config schema + validation
├── policies/
│   ├── default.yaml              # Ships with ClawClip
│   └── examples/
│       ├── strict.yaml           # Block everything, approve all
│       ├── relaxed.yaml          # Allow most, approve destructive
│       └── enterprise.yaml       # Compliance-focused
└── tests/
    └── ...
```

## See Also

- [[clawclip-hook-strategy]] — detailed hook mapping with all 24 hooks
- [[policy-engine]] — YAML policy schema and examples
- [[openclaw-plugin-system]] — OpenClaw plugin API and hook system
- [[openclaw-security]] — built-in security components we complement
- [[product/mvp-scope]] — what's in v0.1 vs later
