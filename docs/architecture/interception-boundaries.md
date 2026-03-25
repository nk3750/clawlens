# ClawClip Interception Boundaries

What ClawClip can and can't control. This is a fundamental architectural constraint that shapes our policy design, documentation, and user expectations.

## The Boundary

ClawClip intercepts at the **OpenClaw tool call boundary**. The `before_tool_call` hook fires before each of the 30 built-in tools executes. We see `{toolName, params}` and can block, approve, or allow.

We do NOT see what happens inside a tool after it executes.

## What We CAN Intercept

Every action the agent takes goes through a tool call:

| Agent action | Tool call | Params we see | Policy examples |
|---|---|---|---|
| Run a script | `exec` | `{command: "python3 seo_audit.py"}` | Match command pattern |
| Edit a file | `write` | `{path: "sitemap.xml", content: "..."}` | Match file path |
| Push to git | `exec` | `{command: "git push origin main"}` | Require approval for git push |
| Fetch a URL | `web_fetch` | `{url: "https://analytics.google.com"}` | Allow/block by URL |
| Send a message | `message` | `{to: "...", content: "..."}` | Require approval for outbound |
| Schedule a task | `cron` | `{name: "...", cron: "0 7 * * *"}` | Require approval for new schedules |
| Read a file | `read` | `{path: "~/Projects/config.json"}` | Allow (safe) |
| Spawn sub-agent | `sessions_spawn` | `{config: {...}}` | Require approval |
| Search the web | `web_search` | `{query: "..."}` | Allow/block by query |
| Browse a site | `browser` | `{url: "...", action: "..."}` | Match URL pattern |

**We match on tool name + parameters.** This covers the vast majority of agent actions because OpenClaw agents naturally make many small tool calls — the LLM reasons step-by-step and calls tools one at a time.

## What We CAN'T Intercept

### Subprocess internals

Once `exec` fires and a subprocess starts, whatever it does internally is invisible to ClawClip:

```
Agent: "Run the SEO pipeline"
  → exec({command: "python3 seo_pipeline.py"})
    → ClawClip: sees command, can approve/block ✓
      → python3 starts...
        → requests.post("https://api.google.com") ← invisible ✗
        → os.remove("backup.sql")                 ← invisible ✗
        → smtplib.send(email)                     ← invisible ✗
```

This applies to:
- Any `exec` call — the shell command's internal behavior
- `process` (background processes) — same issue
- Browser automation — we see the `browser` tool call but not every internal page action
- Cron job subprocesses — once the scheduled command runs, its internals are opaque

### LLM reasoning

We can observe `llm_input` and `llm_output` via hooks (fire-and-forget, parallel), but we can't block or modify the LLM's reasoning. We can only act on the tool calls that reasoning produces.

### Network calls outside OpenClaw

If a script or process makes direct network calls (HTTP requests, database connections, SMTP), those bypass OpenClaw's tool system entirely. ClawClip only sees what goes through OpenClaw's 30 tools.

## When This Matters

**Good scenario for ClawClip:** Agent does granular tool calls.
```
Agent: "I'll audit the SEO"
  → read({path: "sitemap.xml"})              ← ClawClip sees ✓
  → web_fetch({url: "https://site.com"})     ← ClawClip sees ✓
  → exec({command: "lighthouse https://..."}) ← ClawClip sees ✓
  → write({path: "audit-report.md"})         ← ClawClip sees ✓
  → message({content: "Audit done"})         ← ClawClip sees ✓
```
Each step is interceptable. This is how well-designed skills work.

**Bad scenario for ClawClip:** Agent runs a monolithic script.
```
Agent: "I'll audit the SEO"
  → exec({command: "python3 do_everything.py"})  ← ClawClip sees this ONE call
    → internally does 50 things                   ← invisible
```
We can only gate the entry point.

## Mitigation Strategies

### Policy design
- **Block interpreter calls by default** — require approval for `python3`, `node`, `bash -c` etc. These are the entry points to opaque execution.
- **Allow specific scripts by name** — `python3 seo_audit.py` approved, `python3 *` requires approval.
- **Rate limit exec** — "max 10 exec calls per hour" catches runaway automation.

### Skill design guidance
- **Encourage granular tool use** — skills should have the agent make many small tool calls, not one big script.
- **Document in policy what scripts do** — so the user understands what they're approving.

### Future (v0.2+)
- **Cross-action pattern detection** — "agent read credentials.json then called web_fetch" is suspicious even if each individual call is allowed.
- **Exec output scanning** — `after_tool_call` sees the result. We could flag suspicious output patterns.

## The Bottom Line

ClawClip is a **tool-call firewall**, not a sandbox. We control WHAT the agent can do (which tools, which parameters). We don't control what happens inside those tools after they execute.

This is the same model as a network firewall — it controls which connections are allowed, not what data flows through them. For deeper isolation (sandboxing subprocess behavior), that's OpenClaw's sandbox system or infrastructure-level tools like NemoClaw. ClawClip complements those — see [[decisions/003-complement-not-replace]].

## See Also

- [[openclaw-plugin-system]] — `before_tool_call` hook details
- [[openclaw-security]] — built-in exec approvals (shell only)
- [[architecture/clawclip-hook-strategy]] — which hooks we register
- [[decisions/003-complement-not-replace]] — layered security model
