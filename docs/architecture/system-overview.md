# ClawClip System Overview

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Daemon                           │
│                                                             │
│  ┌─────────┐    ┌──────────────────────────────────────┐   │
│  │  PRISM   │    │          ClawClip Skill               │   │
│  │ (pri: 0) │    │          (pri: 10)                    │   │
│  │          │    │                                      │   │
│  │ Perms ✓  │    │  ┌────────────────────────────────┐  │   │
│  │ Threats ✓│    │  │     Hook Interceptors          │  │   │
│  │ Sandbox ✓│    │  │  pre_plan │ pre_execute        │  │   │
│  │          │    │  │  post_execute │ on_error        │  │   │
│  └─────┬────┘    │  │  on_approval_timeout           │  │   │
│        │         │  └──────────┬─────────────────────┘  │   │
│        │         │             │                         │   │
│        │         │  ┌──────────▼─────────────────────┐  │   │
│        │         │  │      Policy Engine              │  │   │
│        │         │  │                                │  │   │
│        │         │  │  YAML policies → evaluate      │  │   │
│        │         │  │  action against rules           │  │   │
│        │         │  │  → allow / block / escalate     │  │   │
│        │         │  └──────────┬─────────────────────┘  │   │
│        │         │             │                         │   │
│        │         │  ┌──────────▼─────────────────────┐  │   │
│        │         │  │    Approval Manager             │  │   │
│        │         │  │                                │  │   │
│        │         │  │  Send prompt → wait for user   │  │   │
│        │         │  │  response → approve/deny       │  │   │
│        │         │  │  Timeout → default deny        │  │   │
│        │         │  └──────────┬─────────────────────┘  │   │
│        │         │             │                         │   │
│        │         │  ┌──────────▼─────────────────────┐  │   │
│        │         │  │      Audit Logger               │  │   │
│        │         │  │                                │  │   │
│        │         │  │  Log every decision + context   │  │   │
│        │         │  │  Structured JSON log            │  │   │
│        │         │  └──────────┬─────────────────────┘  │   │
│        │         │             │                         │   │
│        │         │  ┌──────────▼─────────────────────┐  │   │
│        │         │  │    Digest Generator             │  │   │
│        │         │  │                                │  │   │
│        │         │  │  Daily/weekly summary of        │  │   │
│        │         │  │  agent activity for user        │  │   │
│        │         │  └────────────────────────────────┘  │   │
│        │         │                                      │   │
│        │         └──────────────────────────────────────┘   │
│        │                                                     │
│        ▼                                                     │
│  ┌──────────┐                                               │
│  │  Skill   │                                               │
│  │ Runtime  │  ← action executes (or is blocked)            │
│  └──────────┘                                               │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Hook Interceptors

The entry points where ClawClip receives control from OpenClaw's lifecycle system.

**Responsibilities:**
- Register for relevant lifecycle hooks at startup
- Extract action metadata from `SkillContext`
- Pass structured action data to the Policy Engine
- Return `HookResult` to the runtime (allow/block/approve_required)

**Hooks registered (v0.1):**

| Hook | Purpose |
|------|---------|
| `pre_plan` | Inject policy constraints into planning context |
| `pre_execute` | Core enforcement — evaluate policy before each action |
| `post_execute` | Audit logging after successful actions |
| `on_error` | Log errors, detect failure loops |
| `on_approval_timeout` | Block action when user doesn't respond |

See [[clawclip-hook-strategy]] for detailed hook strategy.

### 2. Policy Engine

Evaluates actions against user-defined rules.

**Responsibilities:**
- Load and parse YAML policy files
- Match incoming actions against policy rules
- Return a decision: `allow`, `block`, `approval_required`
- Support rule priorities and cascading defaults

**Key design:**
- Policies are YAML — see [[policy-engine]] for schema
- Rules match on skill name, action type, parameters, time of day, rate
- Default policy: approve all destructive actions, allow reads
- Users can customize via config file or chat commands

See [[policy-engine]] for full specification.

### 3. Approval Manager

Handles human-in-the-loop approval flows.

**Responsibilities:**
- Send approval prompts to the user's active channel (WhatsApp, web chat, etc.)
- Wait for user response (approve/deny) with configurable timeout
- Format the approval prompt with action details in plain language
- Track pending approvals and their state
- Default to deny on timeout

**Approval prompt example:**
```
🔒 ClawClip: Approval needed

The agent wants to:
  Send an email to boss@company.com
  Subject: "Quarterly report"
  Via: email-send skill

Reply YES to approve or NO to deny.
(Auto-denied in 5 minutes if no response)
```

### 4. Audit Logger

Records every action and decision for accountability.

**Responsibilities:**
- Log every `pre_execute` decision (allow/block/escalate) with full context
- Log every `post_execute` result (success/failure)
- Structured JSON format for parseability
- Local file storage (v0.1), with export capability

**Log entry format:**
```json
{
  "timestamp": "2026-03-15T14:30:00Z",
  "request_id": "req_abc123",
  "skill": "email-send",
  "action": "send",
  "parameters": { "to": "boss@company.com", "subject": "Quarterly report" },
  "policy_rule": "email.require_approval",
  "decision": "approval_required",
  "user_response": "approved",
  "execution_result": "success",
  "duration_ms": 1200
}
```

### 5. Digest Generator

Creates human-readable summaries of agent activity.

**Responsibilities:**
- Aggregate audit log entries over a time window
- Generate a plain-language summary of what the agent did
- Highlight blocked actions, approved actions, and anomalies
- Deliver via the user's preferred channel

**Digest example:**
```
📋 ClawClip Daily Digest — March 15, 2026

Your agent performed 23 actions today:
  ✅ 18 auto-approved (file reads, calendar checks)
  🔒 3 required your approval (2 emails, 1 file delete)
  ❌ 2 blocked by policy (shell commands)

Notable:
  • Sent 2 emails (both approved by you)
  • Tried to run `rm -rf ~/Downloads/old` — blocked by filesystem policy
  • Read 14 files in ~/Projects/webapp
```

**v0.1:** Basic digest via audit log aggregation. v0.2: LLM-generated natural language summaries.

## Data Flow: Action Through ClawClip

```
1. Agent plans action (e.g., "send email")
2. OpenClaw triggers pre_execute hook
3. PRISM evaluates (priority 0) → ALLOW
4. ClawClip evaluates (priority 10):
   a. Hook Interceptor extracts action metadata
   b. Policy Engine matches against rules
   c. Decision:
      - ALLOW → return { action: 'allow' } → skill executes
      - BLOCK → return { action: 'block', reason: '...' } → skill denied
      - APPROVAL_REQUIRED → Approval Manager sends prompt
        → User responds YES → return { action: 'allow' }
        → User responds NO → return { action: 'block' }
        → Timeout → return { action: 'block' }
5. post_execute hook fires → Audit Logger records result
6. End of day → Digest Generator summarizes activity
```

## File Structure (within ClawClip skill)

```
clawclip/
├── manifest.yaml           # OpenClaw skill manifest
├── src/
│   ├── index.ts            # Entry point, hook registration
│   ├── hooks/
│   │   ├── pre-plan.ts     # pre_plan hook handler
│   │   ├── pre-execute.ts  # pre_execute hook handler
│   │   ├── post-execute.ts # post_execute hook handler
│   │   ├── on-error.ts     # on_error hook handler
│   │   └── on-timeout.ts   # on_approval_timeout handler
│   ├── policy/
│   │   ├── engine.ts       # Policy evaluation logic
│   │   ├── parser.ts       # YAML policy parser
│   │   └── types.ts        # Policy types and interfaces
│   ├── approval/
│   │   ├── manager.ts      # Approval flow orchestration
│   │   └── formatter.ts    # Prompt formatting
│   ├── audit/
│   │   ├── logger.ts       # Structured audit logging
│   │   └── digest.ts       # Digest generation
│   └── config.ts           # ClawClip configuration
├── policies/
│   ├── default.yaml        # Default policy (ships with ClawClip)
│   └── examples/
│       ├── strict.yaml     # Block everything, approve all
│       ├── relaxed.yaml    # Allow most, approve destructive
│       └── enterprise.yaml # Compliance-focused
├── tests/
│   └── ...
└── README.md
```

## See Also

- [[clawclip-hook-strategy]] — detailed hook registration plan
- [[policy-engine]] — YAML policy schema and examples
- [[openclaw-plugin-system]] — OpenClaw SDK we build on
- [[openclaw-security-prism]] — PRISM layer that runs before us
- [[product/mvp-scope]] — what's in v0.1 vs later
