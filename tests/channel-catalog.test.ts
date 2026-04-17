import { describe, expect, it } from "vitest";
import { parseSessionKey, resolveChannel } from "../src/dashboard/channel-catalog";

describe("resolveChannel", () => {
  it("returns catalog meta for a known messaging channel", () => {
    const meta = resolveChannel("telegram");
    expect(meta.kind).toBe("messaging");
    expect(meta.label).toBe("Telegram");
    expect(meta.id).toBe("telegram");
  });

  it("returns catalog meta for known execution contexts", () => {
    expect(resolveChannel("main").kind).toBe("direct");
    expect(resolveChannel("subagent").kind).toBe("subagent");
    expect(resolveChannel("cron").kind).toBe("schedule");
    expect(resolveChannel("heartbeat").kind).toBe("schedule");
    expect(resolveChannel("hook").kind).toBe("hook");
    expect(resolveChannel("unknown").kind).toBe("unknown");
  });

  it("synthesizes unknown meta with title-cased label for new ids", () => {
    const meta = resolveChannel("foobar");
    expect(meta.kind).toBe("unknown");
    expect(meta.label).toBe("Foobar");
    expect(meta.id).toBe("foobar");
  });

  it("title-cases hyphenated unknown ids", () => {
    expect(resolveChannel("foo-bar").label).toBe("Foo Bar");
    expect(resolveChannel("foo_bar").label).toBe("Foo Bar");
  });

  it("handles messaging channels with colors", () => {
    expect(resolveChannel("slack").color).toBeDefined();
    expect(resolveChannel("whatsapp").color).toBe("#25D366");
  });

  it("covers all 16 messaging channels referenced in the spec", () => {
    const messaging = [
      "telegram",
      "whatsapp",
      "slack",
      "discord",
      "matrix",
      "imessage",
      "signal",
      "line",
      "feishu",
      "msteams",
      "mattermost",
      "bluebubbles",
      "nextcloud-talk",
      "nostr",
      "zalo",
      "webchat",
    ];
    for (const id of messaging) {
      expect(resolveChannel(id).kind).toBe("messaging");
    }
  });
});

describe("parseSessionKey", () => {
  it("parses a direct main session", () => {
    const parsed = parseSessionKey("agent:seo:main");
    expect(parsed).not.toBeNull();
    expect(parsed?.agentId).toBe("seo");
    expect(parsed?.channel.id).toBe("main");
    expect(parsed?.subPath).toEqual([]);
  });

  it("parses a subagent session with uuid sub-path", () => {
    const parsed = parseSessionKey("agent:main:subagent:abc-123");
    expect(parsed).not.toBeNull();
    expect(parsed?.agentId).toBe("main");
    expect(parsed?.channel.id).toBe("subagent");
    expect(parsed?.subPath).toEqual(["abc-123"]);
  });

  it("parses a cron session", () => {
    const parsed = parseSessionKey("agent:seo-growth:cron:trending-watch-001");
    expect(parsed?.channel.id).toBe("cron");
    expect(parsed?.subPath).toEqual(["trending-watch-001"]);
  });

  it("parses a Matrix session with room path", () => {
    const parsed = parseSessionKey("agent:x:matrix:channel:!room:example.org");
    expect(parsed).not.toBeNull();
    expect(parsed?.channel.kind).toBe("messaging");
    expect(parsed?.channel.id).toBe("matrix");
    expect(parsed?.subPath).toEqual(["channel", "!room", "example.org"]);
  });

  it("parses unknown channels with synthesized meta", () => {
    const parsed = parseSessionKey("agent:x:some-new-thing:foo");
    expect(parsed?.channel.kind).toBe("unknown");
    expect(parsed?.channel.label).toBe("Some New Thing");
  });

  it("returns null for empty string", () => {
    expect(parseSessionKey("")).toBeNull();
  });

  it("returns null for malformed keys", () => {
    expect(parseSessionKey("agent")).toBeNull();
    expect(parseSessionKey("agent:")).toBeNull();
    expect(parseSessionKey("not-an-agent:x:main")).toBeNull();
  });
});
