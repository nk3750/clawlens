// Coverage for the 20 new tools added by the activity-category-coverage spec
// (rev 2): media bucket (image, image_generate, video_generate, music_generate,
// tts, pdf, canvas, nodes), orchestration bucket (sessions_spawn move,
// sessions_send, sessions_yield, sessions_history, sessions_list, session_status,
// agents_list, subagents, update_plan), and existing-bucket extensions
// (apply_patch, gateway, x_search, code_execution).
//
// Exercises every display surface — icon, tags, verb, namespace, target string,
// and group verb — plus the action-aware variants on nodes / canvas / gateway /
// subagents. Locks the rule that color = bucket and never varies with action
// (rev 1 anti-pattern).

import { describe, expect, it } from "vitest";
import { formatEventTarget, toolNamespace, verbFor } from "../dashboard/src/lib/eventFormat";
import { groupVerb } from "../dashboard/src/lib/groupEntries";
import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";
import { CATEGORY_META, deriveTags, entryIcon } from "../dashboard/src/lib/utils";

function entry(overrides: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: "2026-04-26T12:00:00.000Z",
    toolName: "read",
    params: {},
    effectiveDecision: "allow",
    category: "exploring",
    ...overrides,
  };
}

// ── Per-tool routing → category metadata sanity ───────────────

describe("entryIcon — non-action new tools (16)", () => {
  // Each tool gets a non-default override that puts it in its bucket color
  // with a tool-specific path. Listing them all here doubles as a regression
  // guard if the override map drifts.
  const cases: Array<{ tool: string; cat: ActivityCategory }> = [
    { tool: "image", cat: "media" },
    { tool: "image_generate", cat: "media" },
    { tool: "video_generate", cat: "media" },
    { tool: "music_generate", cat: "media" },
    { tool: "tts", cat: "media" },
    { tool: "pdf", cat: "media" },
    { tool: "sessions_send", cat: "orchestration" },
    { tool: "sessions_yield", cat: "orchestration" },
    { tool: "sessions_history", cat: "orchestration" },
    { tool: "sessions_list", cat: "orchestration" },
    { tool: "session_status", cat: "orchestration" },
    { tool: "agents_list", cat: "orchestration" },
    { tool: "update_plan", cat: "orchestration" },
    { tool: "apply_patch", cat: "changes" },
    { tool: "x_search", cat: "web" },
    { tool: "code_execution", cat: "scripts" },
  ];

  it.each(cases)("$tool → bucket color $cat with non-empty path", ({ tool, cat }) => {
    const icon = entryIcon(entry({ toolName: tool, category: cat }));
    expect(icon.color).toBe(CATEGORY_META[cat].color);
    expect(icon.path.length).toBeGreaterThan(0);
  });
});

describe("entryIcon — action-aware tools", () => {
  it("nodes status → media color, pulse-shaped path", () => {
    const icon = entryIcon(
      entry({ toolName: "nodes", category: "media", params: { action: "status" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.media.color);
    expect(icon.path.length).toBeGreaterThan(0);
  });

  it("nodes camera_snap → media color, camera-shaped path", () => {
    const icon = entryIcon(
      entry({ toolName: "nodes", category: "media", params: { action: "camera_snap" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.media.color);
  });

  it("nodes screen_record → media color, screen-shaped path", () => {
    const icon = entryIcon(
      entry({ toolName: "nodes", category: "media", params: { action: "screen_record" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.media.color);
  });

  it("nodes system_run → media color (no action-color juggle)", () => {
    const icon = entryIcon(
      entry({ toolName: "nodes", category: "media", params: { action: "system_run" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.media.color);
  });

  it("canvas snapshot → media color", () => {
    const icon = entryIcon(
      entry({ toolName: "canvas", category: "media", params: { action: "snapshot" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.media.color);
  });

  it("canvas navigate → media color", () => {
    const icon = entryIcon(
      entry({ toolName: "canvas", category: "media", params: { action: "navigate" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.media.color);
  });

  it("canvas eval → media color", () => {
    const icon = entryIcon(
      entry({ toolName: "canvas", category: "media", params: { action: "eval" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.media.color);
  });

  it("gateway config.update → changes color (no risk-color juggle)", () => {
    const icon = entryIcon(
      entry({ toolName: "gateway", category: "changes", params: { action: "config.update" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.changes.color);
  });

  it("gateway restart → changes color", () => {
    const icon = entryIcon(
      entry({ toolName: "gateway", category: "changes", params: { action: "restart" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.changes.color);
  });

  it("gateway config.get → changes color (read action stays in mutation bucket)", () => {
    const icon = entryIcon(
      entry({ toolName: "gateway", category: "changes", params: { action: "config.get" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.changes.color);
  });

  it("subagents list → orchestration color", () => {
    const icon = entryIcon(
      entry({ toolName: "subagents", category: "orchestration", params: { action: "list" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.orchestration.color);
  });

  it("subagents kill → orchestration color (severity rides risk axis, not color)", () => {
    const icon = entryIcon(
      entry({ toolName: "subagents", category: "orchestration", params: { action: "kill" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.orchestration.color);
  });

  it("subagents steer → orchestration color", () => {
    const icon = entryIcon(
      entry({ toolName: "subagents", category: "orchestration", params: { action: "steer" } }),
    );
    expect(icon.color).toBe(CATEGORY_META.orchestration.color);
  });
});

// ── Color invariant — bucket-bound across all actions ─────────

describe("color stays bucket-bound across all actions", () => {
  it("color stays bucket-bound across all actions for nodes", () => {
    const actions = [
      "status",
      "describe",
      "pending",
      "approve",
      "reject",
      "notify",
      "camera_snap",
      "camera_clip",
      "screen_record",
      "system_run",
    ];
    const colors = actions.map(
      (a) =>
        entryIcon(entry({ toolName: "nodes", category: "media", params: { action: a } })).color,
    );
    expect(new Set(colors)).toEqual(new Set([CATEGORY_META.media.color]));
  });

  it("color stays bucket-bound across all actions for canvas", () => {
    const actions = ["snapshot", "eval", "navigate", "present", "hide"];
    const colors = actions.map(
      (a) =>
        entryIcon(entry({ toolName: "canvas", category: "media", params: { action: a } })).color,
    );
    expect(new Set(colors)).toEqual(new Set([CATEGORY_META.media.color]));
  });

  it("color stays bucket-bound across all actions for gateway", () => {
    const actions = ["config.update", "config.get", "restart"];
    const colors = actions.map(
      (a) =>
        entryIcon(entry({ toolName: "gateway", category: "changes", params: { action: a } })).color,
    );
    expect(new Set(colors)).toEqual(new Set([CATEGORY_META.changes.color]));
  });

  it("color stays bucket-bound across all actions for subagents", () => {
    const actions = ["list", "kill", "steer"];
    const colors = actions.map(
      (a) =>
        entryIcon(
          entry({ toolName: "subagents", category: "orchestration", params: { action: a } }),
        ).color,
    );
    expect(new Set(colors)).toEqual(new Set([CATEGORY_META.orchestration.color]));
  });

  it("toolIconOverride color matches entryIcon color across actions for each action-tool", () => {
    // Stronger guard: any future override that returns a different color for
    // a different action breaks this test. Locks the spec invariant in §6.
    const cases: Array<{ tool: string; cat: ActivityCategory; actions: string[] }> = [
      {
        tool: "nodes",
        cat: "media",
        actions: ["status", "camera_snap", "screen_record", "system_run", "approve"],
      },
      { tool: "canvas", cat: "media", actions: ["snapshot", "eval", "navigate"] },
      { tool: "gateway", cat: "changes", actions: ["config.update", "config.get", "restart"] },
      { tool: "subagents", cat: "orchestration", actions: ["list", "kill", "steer"] },
    ];
    for (const { tool, cat, actions } of cases) {
      for (const a of actions) {
        const icon = entryIcon(entry({ toolName: tool, category: cat, params: { action: a } }));
        expect(icon.color).toBe(CATEGORY_META[cat].color);
      }
    }
  });
});

// ── deriveTags ────────────────────────────────────────────────

describe("deriveTags — non-action new tools", () => {
  const cases: Array<[string, string]> = [
    ["apply_patch", "file-patch"],
    ["x_search", "x-search"],
    ["code_execution", "code-exec"],
    ["sessions_send", "session-send"],
    ["sessions_yield", "session-yield"],
    ["sessions_history", "session-history"],
    ["sessions_list", "session-list"],
    ["session_status", "session-status"],
    ["agents_list", "agents-list"],
    ["update_plan", "plan-update"],
    ["image", "image-analyze"],
    ["image_generate", "image-gen"],
    ["video_generate", "video-gen"],
    ["music_generate", "music-gen"],
    ["tts", "tts"],
    ["pdf", "pdf"],
  ];

  it.each(cases)("deriveTags(%s) includes %s", (toolName, expected) => {
    const tags = deriveTags({ toolName, params: {} });
    expect(tags).toContain(expected);
  });
});

describe("deriveTags — action-aware variants", () => {
  it("nodes camera_snap → camera tag", () => {
    expect(deriveTags({ toolName: "nodes", params: { action: "camera_snap" } })).toContain(
      "camera",
    );
  });

  it("nodes screen_record → screen-rec tag", () => {
    expect(deriveTags({ toolName: "nodes", params: { action: "screen_record" } })).toContain(
      "screen-rec",
    );
  });

  it("nodes system_run → node-run tag", () => {
    expect(deriveTags({ toolName: "nodes", params: { action: "system_run" } })).toContain(
      "node-run",
    );
  });

  it("nodes approve → node-decision tag", () => {
    expect(deriveTags({ toolName: "nodes", params: { action: "approve" } })).toContain(
      "node-decision",
    );
  });

  it("canvas snapshot → canvas-snap tag", () => {
    expect(deriveTags({ toolName: "canvas", params: { action: "snapshot" } })).toContain(
      "canvas-snap",
    );
  });

  it("canvas eval → canvas-eval tag", () => {
    expect(deriveTags({ toolName: "canvas", params: { action: "eval" } })).toContain("canvas-eval");
  });

  it("gateway config.update → config-write tag", () => {
    expect(deriveTags({ toolName: "gateway", params: { action: "config.update" } })).toContain(
      "config-write",
    );
  });

  it("gateway config.get → config-read tag", () => {
    expect(deriveTags({ toolName: "gateway", params: { action: "config.get" } })).toContain(
      "config-read",
    );
  });

  it("gateway restart → restart tag", () => {
    expect(deriveTags({ toolName: "gateway", params: { action: "restart" } })).toContain("restart");
  });

  it("subagents kill → subagent-kill tag", () => {
    expect(deriveTags({ toolName: "subagents", params: { action: "kill" } })).toContain(
      "subagent-kill",
    );
  });

  it("subagents steer → subagent-steer tag", () => {
    expect(deriveTags({ toolName: "subagents", params: { action: "steer" } })).toContain(
      "subagent-steer",
    );
  });

  it("action-aware tools without action fall back to tool-level tag", () => {
    expect(deriveTags({ toolName: "nodes", params: {} })).toContain("node");
    expect(deriveTags({ toolName: "canvas", params: {} })).toContain("canvas");
    expect(deriveTags({ toolName: "gateway", params: {} })).toContain("gateway");
    expect(deriveTags({ toolName: "subagents", params: {} })).toContain("subagents");
  });
});

// ── verbFor ───────────────────────────────────────────────────

describe("verbFor — non-action new tools", () => {
  const cases: Array<[string, string]> = [
    ["apply_patch", "patched"],
    ["x_search", "searched"],
    ["code_execution", "executed"],
    ["sessions_send", "sent"],
    ["sessions_yield", "yielded"],
    ["sessions_history", "queried"],
    ["sessions_list", "listed"],
    ["session_status", "checked"],
    ["agents_list", "listed"],
    ["update_plan", "planned"],
    ["image", "analyzed"],
    ["image_generate", "generated"],
    ["video_generate", "generated"],
    ["music_generate", "generated"],
    ["tts", "spoke"],
    ["pdf", "analyzed"],
  ];

  it.each(cases)("verbFor(%s) → %s", (toolName, expected) => {
    expect(verbFor(entry({ toolName }))).toBe(expected);
  });
});

describe("verbFor — action-aware overrides", () => {
  it("nodes camera_snap → captured", () => {
    expect(verbFor(entry({ toolName: "nodes", params: { action: "camera_snap" } }))).toBe(
      "captured",
    );
  });
  it("nodes screen_record → recorded", () => {
    expect(verbFor(entry({ toolName: "nodes", params: { action: "screen_record" } }))).toBe(
      "recorded",
    );
  });
  it("nodes system_run → ran", () => {
    expect(verbFor(entry({ toolName: "nodes", params: { action: "system_run" } }))).toBe("ran");
  });
  it("nodes approve → approved", () => {
    expect(verbFor(entry({ toolName: "nodes", params: { action: "approve" } }))).toBe("approved");
  });
  it("nodes reject → rejected", () => {
    expect(verbFor(entry({ toolName: "nodes", params: { action: "reject" } }))).toBe("rejected");
  });
  it("nodes notify → notified", () => {
    expect(verbFor(entry({ toolName: "nodes", params: { action: "notify" } }))).toBe("notified");
  });
  it("canvas snapshot → captured", () => {
    expect(verbFor(entry({ toolName: "canvas", params: { action: "snapshot" } }))).toBe("captured");
  });
  it("canvas eval → evaluated", () => {
    expect(verbFor(entry({ toolName: "canvas", params: { action: "eval" } }))).toBe("evaluated");
  });
  it("canvas navigate → navigated", () => {
    expect(verbFor(entry({ toolName: "canvas", params: { action: "navigate" } }))).toBe(
      "navigated",
    );
  });
  it("canvas hide → hid", () => {
    expect(verbFor(entry({ toolName: "canvas", params: { action: "hide" } }))).toBe("hid");
  });
  it("gateway restart → restarted", () => {
    expect(verbFor(entry({ toolName: "gateway", params: { action: "restart" } }))).toBe(
      "restarted",
    );
  });
  it("gateway config.update → configured", () => {
    expect(verbFor(entry({ toolName: "gateway", params: { action: "config.update" } }))).toBe(
      "configured",
    );
  });
  it("gateway config.get → queried", () => {
    expect(verbFor(entry({ toolName: "gateway", params: { action: "config.get" } }))).toBe(
      "queried",
    );
  });
  it("subagents kill → killed", () => {
    expect(verbFor(entry({ toolName: "subagents", params: { action: "kill" } }))).toBe("killed");
  });
  it("subagents steer → steered", () => {
    expect(verbFor(entry({ toolName: "subagents", params: { action: "steer" } }))).toBe("steered");
  });
  it("subagents list → listed", () => {
    expect(verbFor(entry({ toolName: "subagents", params: { action: "list" } }))).toBe("listed");
  });
});

// ── toolNamespace ─────────────────────────────────────────────

describe("toolNamespace — non-action new tools", () => {
  const cases: Array<[string, string]> = [
    ["apply_patch", "fs.patch"],
    ["x_search", "web.x"],
    ["code_execution", "runtime.exec"],
    ["sessions_send", "agent.send"],
    ["sessions_yield", "agent.yield"],
    ["sessions_history", "agent.history"],
    ["sessions_list", "agent.list"],
    ["session_status", "agent.status"],
    ["agents_list", "agent.directory"],
    ["update_plan", "agent.plan"],
    ["image", "media.image"],
    ["image_generate", "media.image-gen"],
    ["video_generate", "media.video-gen"],
    ["music_generate", "media.music-gen"],
    ["tts", "media.tts"],
    ["pdf", "media.pdf"],
  ];

  it.each(cases)("toolNamespace(%s) → %s", (toolName, expected) => {
    expect(toolNamespace(entry({ toolName }))).toBe(expected);
  });
});

describe("toolNamespace — action-aware", () => {
  it("nodes camera_snap → nodes.camera_snap", () => {
    expect(toolNamespace(entry({ toolName: "nodes", params: { action: "camera_snap" } }))).toBe(
      "nodes.camera_snap",
    );
  });
  it("canvas snapshot → canvas.snapshot", () => {
    expect(toolNamespace(entry({ toolName: "canvas", params: { action: "snapshot" } }))).toBe(
      "canvas.snapshot",
    );
  });
  it("gateway restart → gateway.restart", () => {
    expect(toolNamespace(entry({ toolName: "gateway", params: { action: "restart" } }))).toBe(
      "gateway.restart",
    );
  });
  it("subagents kill → subagents.kill", () => {
    expect(toolNamespace(entry({ toolName: "subagents", params: { action: "kill" } }))).toBe(
      "subagents.kill",
    );
  });
});

// ── formatEventTarget ─────────────────────────────────────────

describe("formatEventTarget — non-action new tools", () => {
  it("apply_patch — unified-diff path", () => {
    const target = formatEventTarget(
      entry({
        toolName: "apply_patch",
        params: { patch: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new" },
      }),
    );
    expect(target).toBe("src/foo.ts");
  });

  it("apply_patch — Codex *** Update File header", () => {
    const target = formatEventTarget(
      entry({
        toolName: "apply_patch",
        params: {
          patch: "*** Begin Patch\n*** Update File: src/bar.ts\n@@\n-old\n+new\n*** End Patch",
        },
      }),
    );
    expect(target).toBe("src/bar.ts");
  });

  it("apply_patch — malformed patch returns empty (degraded but not broken)", () => {
    expect(
      formatEventTarget(entry({ toolName: "apply_patch", params: { patch: "garbage" } })),
    ).toBe("");
  });

  it("x_search — quoted query", () => {
    expect(
      formatEventTarget(entry({ toolName: "x_search", params: { query: "claude code" } })),
    ).toBe('"claude code"');
  });

  it("code_execution — quoted code", () => {
    expect(
      formatEventTarget(entry({ toolName: "code_execution", params: { code: "print('hi')" } })),
    ).toBe(`"print('hi')"`);
  });

  it("image — path + prompt", () => {
    expect(
      formatEventTarget(
        entry({ toolName: "image", params: { path: "shot.png", prompt: "What's in this?" } }),
      ),
    ).toBe('shot.png — "What\'s in this?"');
  });

  it("image — path only", () => {
    expect(formatEventTarget(entry({ toolName: "image", params: { path: "shot.png" } }))).toBe(
      "shot.png",
    );
  });

  it("image_generate — quoted prompt", () => {
    expect(
      formatEventTarget(entry({ toolName: "image_generate", params: { prompt: "a cat" } })),
    ).toBe('"a cat"');
  });

  it("tts — quoted text", () => {
    expect(formatEventTarget(entry({ toolName: "tts", params: { text: "hello" } }))).toBe(
      '"hello"',
    );
  });

  it("video_generate / music_generate — quoted prompt", () => {
    expect(
      formatEventTarget(entry({ toolName: "video_generate", params: { prompt: "sunset" } })),
    ).toBe('"sunset"');
    expect(
      formatEventTarget(entry({ toolName: "music_generate", params: { prompt: "lofi" } })),
    ).toBe('"lofi"');
  });

  it("pdf — file_path fallback when no path/url", () => {
    expect(formatEventTarget(entry({ toolName: "pdf", params: { file_path: "/tmp/r.pdf" } }))).toBe(
      "/tmp/r.pdf",
    );
  });

  it("sessions_send — recipient + message", () => {
    expect(
      formatEventTarget(
        entry({
          toolName: "sessions_send",
          params: { sessionKey: "agent:beta:main", message: "ping" },
        }),
      ),
    ).toBe('agent:beta:main: "ping"');
  });

  it("sessions_send — message only (no recipient)", () => {
    expect(
      formatEventTarget(entry({ toolName: "sessions_send", params: { message: "ping" } })),
    ).toBe('"ping"');
  });

  it("sessions_yield — sessionKey", () => {
    expect(
      formatEventTarget(
        entry({ toolName: "sessions_yield", params: { sessionKey: "agent:gamma:main" } }),
      ),
    ).toBe("agent:gamma:main");
  });

  it("session_status / sessions_history / sessions_list — sessionKey", () => {
    for (const tool of ["session_status", "sessions_history", "sessions_list"] as const) {
      expect(
        formatEventTarget(entry({ toolName: tool, params: { sessionKey: "agent:x:main" } })),
      ).toBe("agent:x:main");
    }
  });

  it("agents_list — empty target", () => {
    expect(formatEventTarget(entry({ toolName: "agents_list", params: {} }))).toBe("");
  });

  it("update_plan — surfaces in_progress step text + count", () => {
    const target = formatEventTarget(
      entry({
        toolName: "update_plan",
        params: {
          plan: [
            { step: "scaffold", status: "completed" },
            { step: "wire api", status: "in_progress" },
            { step: "deploy", status: "pending" },
          ],
        },
      }),
    );
    expect(target).toBe('3 steps · "wire api"');
  });

  it("update_plan — empty plan returns explanation", () => {
    expect(
      formatEventTarget(
        entry({ toolName: "update_plan", params: { plan: [], explanation: "thinking" } }),
      ),
    ).toBe("thinking");
  });

  it("update_plan — missing plan returns explanation", () => {
    expect(
      formatEventTarget(entry({ toolName: "update_plan", params: { explanation: "thinking" } })),
    ).toBe("thinking");
  });

  it("update_plan — non-array plan guarded", () => {
    expect(
      formatEventTarget(entry({ toolName: "update_plan", params: { plan: "not array" } })),
    ).toBe("");
  });
});

describe("formatEventTarget — action-aware new tools", () => {
  it("canvas navigate → url", () => {
    expect(
      formatEventTarget(
        entry({ toolName: "canvas", params: { action: "navigate", url: "https://x.com" } }),
      ),
    ).toBe("https://x.com");
  });

  it("canvas snapshot → format or 'snapshot'", () => {
    expect(formatEventTarget(entry({ toolName: "canvas", params: { action: "snapshot" } }))).toBe(
      "snapshot",
    );
  });

  it("nodes system_run with node + command", () => {
    expect(
      formatEventTarget(
        entry({
          toolName: "nodes",
          params: { action: "system_run", node: "raspi-1", command: "uptime" },
        }),
      ),
    ).toBe("raspi-1: uptime");
  });

  it("nodes system_run with target field (no node)", () => {
    expect(
      formatEventTarget(
        entry({
          toolName: "nodes",
          params: { action: "system_run", target: "raspi-2", command: "ls" },
        }),
      ),
    ).toBe("raspi-2: ls");
  });

  it("nodes camera_snap with node", () => {
    expect(
      formatEventTarget(
        entry({ toolName: "nodes", params: { action: "camera_snap", node: "raspi-1" } }),
      ),
    ).toBe("camera_snap raspi-1");
  });

  it("gateway config.update → path", () => {
    expect(
      formatEventTarget(
        entry({ toolName: "gateway", params: { action: "config.update", path: "rules.yaml" } }),
      ),
    ).toBe("rules.yaml");
  });

  it("gateway restart → empty target", () => {
    expect(formatEventTarget(entry({ toolName: "gateway", params: { action: "restart" } }))).toBe(
      "",
    );
  });

  it("subagents kill with target", () => {
    expect(
      formatEventTarget(
        entry({ toolName: "subagents", params: { action: "kill", target: "abc" } }),
      ),
    ).toBe("kill abc");
  });

  it("subagents list (default action)", () => {
    expect(formatEventTarget(entry({ toolName: "subagents", params: {} }))).toBe("list");
  });
});

// ── groupVerb ─────────────────────────────────────────────────

describe("groupVerb — new tools", () => {
  const cases: Array<[string, string, string]> = [
    ["apply_patch", "Patched", "files"],
    ["gateway", "Configured", "gateway"],
    ["x_search", "Searched", "X posts"],
    ["code_execution", "Executed", "code"],
    ["sessions_history", "Queried", "session histories"],
    ["sessions_list", "Listed", "sessions"],
    ["sessions_send", "Messaged", "sessions"],
    ["sessions_yield", "Yielded", "sessions"],
    ["session_status", "Checked", "session statuses"],
    ["subagents", "Managed", "subagents"],
    ["agents_list", "Listed", "agents"],
    ["update_plan", "Planned", "steps"],
    ["image", "Analyzed", "images"],
    ["image_generate", "Generated", "images"],
    ["video_generate", "Generated", "videos"],
    ["music_generate", "Generated", "tracks"],
    ["tts", "Spoke", "phrases"],
    ["pdf", "Analyzed", "PDFs"],
    ["canvas", "Used", "canvas"],
    ["nodes", "Operated", "nodes"],
  ];

  it.each(cases)("groupVerb(%s) → %s %s", (tool, verb, noun) => {
    expect(groupVerb(tool)).toEqual({ verb, noun });
  });
});
