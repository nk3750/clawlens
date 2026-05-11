import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard: OpenClaw's gateway-startup-plugin-ids:shouldConsiderForGatewayStartup
// only synchronously loads a plugin at gateway boot if one of these holds:
//   - manifest.activation.onStartup === true
//   - the plugin is the configured contextEngine slot
//   - the plugin is a memory plugin matching specific slot/dreaming rules
// ClawLens is none of (2) or (3), so dropping activation.onStartup makes the gateway
// skip ClawLens at synchronous startup and only load it minutes later via a dynamic
// path — surfacing as a 404 on the dashboard URL immediately after gateway restart.
// Verified against openclaw v2026.5.7 source:
//   src/plugins/gateway-startup-plugin-ids.ts:134-154
describe("openclaw.plugin.json", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "openclaw.plugin.json"), "utf8"),
  );

  it("declares activation.onStartup so the gateway loads ClawLens at synchronous startup", () => {
    expect(manifest.activation?.onStartup).toBe(true);
  });
});
