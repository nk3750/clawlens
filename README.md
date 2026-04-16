> **Status:** Initial draft — under review
>
> **TODOs before launch:**
> - [ ] Wordsmith — review tone, phrasing, and flow with Neelabh
> - [ ] Screenshot — take real dashboard screenshot, save to `docs/screenshots/homepage.png`
> - [ ] GitHub org — decide AvidClaw vs nk3750 vs new `clawlens` org, update clone URL
> - [ ] Test install flow — run the Quick Start steps on a clean machine end-to-end
> - [ ] Add logo — once designed, add at top of README

# ClawLens

Agent observability for OpenClaw. See everything your AI agents do, score risk in real-time, get alerted when something looks dangerous.

## The Problem

A Meta AI researcher told her OpenClaw agent to "confirm before acting." It deleted 200+ emails without asking -- the instruction was lost when the context window compacted. A developer gave his agent access to iMessage for a morning digest. It sent 500+ messages to his contacts. He had to pull the power cord.

These are real incidents. In every case, the agent had permission to use the tool but no governance layer on *when* or *how much*. ClawLens fills that gap.

## What You Get

- **Multi-agent dashboard** -- see all your agents, their status, and what they're doing right now
- **Every tool call scored 0-100 for risk** -- instantly, using a two-tier scoring engine
- **LLM evaluation for suspicious actions** -- explains *why* a command is dangerous, not just *that* it is
- **Real-time Telegram alerts** -- high-risk actions trigger notifications within seconds
- **Live activity feed** -- tool calls stream in as they happen, color-coded by risk level
- **Tamper-evident audit trail** -- SHA-256 hash-chained JSONL log of every action
- **User-defined guardrails** -- block or require approval for specific actions, created from observed behavior
- **Zero-config start** -- install, open dashboard, see your agents. No policy writing required.

<!-- TODO: Replace with actual screenshot after dashboard is running -->
![ClawLens Dashboard](docs/screenshots/homepage.png)

## Quick Start

### Install from npm

```bash
openclaw plugins install clawlens
```

Restart the gateway, then open the dashboard:

```
http://localhost:18789/plugins/clawlens/
```

That's it. Your agents will appear as soon as they make their first tool call.

### Install from source

```bash
<!-- TODO: Confirm GitHub org — AvidClaw or nk3750 or new clawlens org? -->
git clone https://github.com/AvidClaw/clawLens.git
cd clawLens
npm install
cd dashboard && npm install && npm run build && cd ..
npx tsc -p tsconfig.json
```

Add the plugin path to your `openclaw.json`:

```json
{
  "plugins": { "load": { "paths": ["/path/to/clawLens"] } }
}
```

Restart the gateway.

## How It Works

ClawLens hooks into OpenClaw's plugin system. Every tool call passes through ClawLens before execution:

```
Agent Tool Call --> ClawLens Hook --> Risk Score + Audit --> Tool Executes
                        |
                   Score >= 50?  -->  LLM Evaluation (async)
                   Score >= 80?  -->  Telegram Alert
```

**Tier 1** scores every call deterministically in under 5ms -- tool type, parameters, and context. **Tier 2** sends high-risk calls to an LLM for deeper evaluation with reasoning and risk tags. About 70-80% of calls (reads, searches, globs) never need Tier 2.

ClawLens complements OpenClaw's built-in security. It does not replace exec approvals or tool profiles -- it adds the observability and risk intelligence layer on top.

## Tech Stack

TypeScript (strict mode) + React 18 + Tailwind CSS + Vite. Three production dependencies. 717 tests.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code style, and PR expectations.

```bash
npm run check   # tests + lint -- run this before submitting
```

## License

MIT
