import { describe, expect, it } from "vitest";
import {
  REDACTION_MARKERS,
  redactParams,
  redactString,
  redactUrl,
} from "../../src/privacy/redaction";

// Realistic shapes the spec calls out (§2A L268-274 + sample fixtures L283-291).
// Using concrete-looking values means a regex that only matches "sk-test-XX" will
// pass these tests but fail in production. Use long enough tails to look real.
const SK_TOKEN = "sk-test-abcdefghijklmnopqrstuvwxyz123456";
const GHP_TOKEN = "ghp_abcdef0123456789abcdef0123456789abcd";
const GH_PAT = "github_pat_11ABCDE5Q0abc123XYZdef456GHIjkl789MNOpqr012STUvwx345YZA678BCDefg";
const SLACK_BOT = "xoxb-0000000000-0000000000000-AAAAAAAAAAAAAAAAAAAAAAAA";
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const PEM_BLOCK = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEpAIBAAKCAQEAvX1V8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

describe("redactString — Authorization headers", () => {
  it("redacts Bearer tokens in Authorization headers", () => {
    const input = `curl -H "Authorization: Bearer ${SK_TOKEN}" https://api.example.com`;
    const out = redactString(input);
    expect(out).not.toContain(SK_TOKEN);
    expect(out).toContain("<redacted:");
    // Preserves useful shape
    expect(out).toContain("curl");
    expect(out).toContain("Authorization");
    expect(out).toContain("api.example.com");
  });

  it("redacts Basic auth", () => {
    const input = `Authorization: Basic dXNlcjpwYXNzd29yZA==`;
    const out = redactString(input);
    expect(out).not.toContain("dXNlcjpwYXNzd29yZA==");
    expect(out).toContain("<redacted:");
    expect(out).toContain("Authorization");
  });

  it("redacts x-api-key header values", () => {
    const input = `curl -H 'x-api-key: ${SK_TOKEN}' https://api.example.com`;
    const out = redactString(input);
    expect(out).not.toContain(SK_TOKEN);
    expect(out).toContain("x-api-key");
  });

  it("redacts X-Auth-Token", () => {
    const input = `X-Auth-Token: super-secret-deadbeef-1234567890`;
    const out = redactString(input);
    expect(out).not.toContain("super-secret-deadbeef-1234567890");
    expect(out).toContain("X-Auth-Token");
  });

  it("redacts Cookie header values", () => {
    const input = `Cookie: session=abc123def456ghi789jkl012; csrf=xyz987uvw654`;
    const out = redactString(input);
    expect(out).not.toContain("abc123def456ghi789jkl012");
    expect(out).toContain("<redacted:");
    expect(out).toContain("Cookie");
  });
});

describe("redactString — CLI flags", () => {
  it("redacts --token VALUE", () => {
    const input = `gh api repos/acme/private --token ${GHP_TOKEN}`;
    const out = redactString(input);
    expect(out).not.toContain(GHP_TOKEN);
    expect(out).toContain("--token");
    expect(out).toContain("gh");
  });

  it("redacts --token=VALUE", () => {
    const input = `cli --token=${GHP_TOKEN}`;
    const out = redactString(input);
    expect(out).not.toContain(GHP_TOKEN);
    expect(out).toContain("--token");
  });

  it("redacts --api-key VALUE", () => {
    const input = `app --api-key ${SK_TOKEN}`;
    const out = redactString(input);
    expect(out).not.toContain(SK_TOKEN);
    expect(out).toContain("--api-key");
  });

  it("redacts --password VALUE", () => {
    const input = `mysql --password=hunter2-not-very-secure`;
    const out = redactString(input);
    expect(out).not.toContain("hunter2-not-very-secure");
    expect(out).toContain("--password");
  });

  it("redacts -p VALUE for short password flag", () => {
    const input = `psql -p hunter2-deadbeef`;
    const out = redactString(input);
    expect(out).not.toContain("hunter2-deadbeef");
  });
});

describe("redactString — env assignments", () => {
  it("redacts GITHUB_TOKEN=VALUE inline", () => {
    const input = `GITHUB_TOKEN=${GHP_TOKEN} npm publish`;
    const out = redactString(input);
    expect(out).not.toContain(GHP_TOKEN);
    expect(out).toContain("GITHUB_TOKEN");
    expect(out).toContain("npm publish");
  });

  it("redacts ANTHROPIC_API_KEY=VALUE", () => {
    const input = `ANTHROPIC_API_KEY=${SK_TOKEN} node script.js`;
    const out = redactString(input);
    expect(out).not.toContain(SK_TOKEN);
    expect(out).toContain("ANTHROPIC_API_KEY");
  });

  it("redacts arbitrary *_SECRET=VALUE", () => {
    const input = `MY_APP_SECRET=topsecret-value-deadbeef foo`;
    const out = redactString(input);
    expect(out).not.toContain("topsecret-value-deadbeef");
    expect(out).toContain("MY_APP_SECRET");
  });

  it("redacts PASSWORD=VALUE", () => {
    const input = `PASSWORD=correct-horse-battery-staple foo`;
    const out = redactString(input);
    expect(out).not.toContain("correct-horse-battery-staple");
    expect(out).toContain("PASSWORD");
  });

  it("does NOT redact non-secret env-style assignments", () => {
    const input = `NODE_ENV=production PORT=18789 npm start`;
    const out = redactString(input);
    expect(out).toContain("NODE_ENV=production");
    expect(out).toContain("PORT=18789");
  });
});

describe("redactString — token prefixes in free text", () => {
  it("redacts bare sk-test-... token in any context", () => {
    const input = `the value was ${SK_TOKEN}, do not log`;
    const out = redactString(input);
    expect(out).not.toContain(SK_TOKEN);
    expect(out).toContain("<redacted:");
  });

  it("redacts ghp_ prefix tokens", () => {
    const input = `token: ${GHP_TOKEN}`;
    const out = redactString(input);
    expect(out).not.toContain(GHP_TOKEN);
  });

  it("redacts github_pat_ prefix tokens", () => {
    const input = `gh auth login --with-token ${GH_PAT}`;
    const out = redactString(input);
    expect(out).not.toContain(GH_PAT);
  });

  it("redacts xoxb- slack bot tokens", () => {
    const input = `slack token ${SLACK_BOT}`;
    const out = redactString(input);
    expect(out).not.toContain(SLACK_BOT);
  });

  it("redacts AKIA... AWS access keys", () => {
    const input = `aws_access_key_id = ${AWS_KEY}`;
    const out = redactString(input);
    expect(out).not.toContain(AWS_KEY);
  });

  it("redacts PEM private key blocks (BEGIN..END)", () => {
    const input = `key file:\n${PEM_BLOCK}\nend of file`;
    const out = redactString(input);
    expect(out).not.toContain("MIIEpAIBAAKCAQEA");
    expect(out).toContain("<redacted:private-key>");
  });
});

describe("redactUrl", () => {
  it("removes userinfo from URL", () => {
    const input = "https://user:pass@api.example.com/v1/resource";
    const out = redactUrl(input);
    expect(out).not.toContain("user:pass");
    expect(out).toContain("api.example.com/v1/resource");
    expect(out).toContain("<redacted:url-credential>");
  });

  it("redacts token query parameter", () => {
    const input = "https://api.example.com/v1/resource?token=secret-deadbeef-12345&page=1";
    const out = redactUrl(input);
    expect(out).not.toContain("secret-deadbeef-12345");
    expect(out).toContain("page=1");
    expect(out).toContain("api.example.com");
  });

  it("redacts api_key query parameter", () => {
    const input = `https://api.example.com/v1/resource?api_key=${SK_TOKEN}&q=hello`;
    const out = redactUrl(input);
    expect(out).not.toContain(SK_TOKEN);
    expect(out).toContain("q=hello");
  });

  it("preserves scheme/host/path for benign URLs", () => {
    const input = "https://api.example.com/v1/resource?page=1&limit=10";
    const out = redactUrl(input);
    expect(out).toBe(input);
  });

  it("returns input unchanged for non-URLs", () => {
    expect(redactUrl("not a url")).toBe("not a url");
  });
});

describe("redactParams — object recursion by key name", () => {
  it("redacts password by key name (any case)", () => {
    const out = redactParams({ password: "hunter2-deadbeef" });
    expect(out.password).toBe(REDACTION_MARKERS.password);
  });

  it("redacts apiKey camelCase", () => {
    const out = redactParams({ apiKey: SK_TOKEN });
    expect(out.apiKey).toBe(REDACTION_MARKERS.token);
  });

  it("redacts api_key snake_case", () => {
    const out = redactParams({ api_key: SK_TOKEN });
    expect(out.api_key).toBe(REDACTION_MARKERS.token);
  });

  it("redacts authorization (header-style key)", () => {
    const out = redactParams({ authorization: `Bearer ${SK_TOKEN}` });
    expect(out.authorization).toBe(REDACTION_MARKERS.authorization);
  });

  it("redacts access_token / refresh_token / client_secret", () => {
    const out = redactParams({
      access_token: "abc-deadbeef-12345",
      refresh_token: "rt-deadbeef-67890",
      client_secret: "cs-deadbeef-abc123",
    });
    expect(out.access_token).toBe(REDACTION_MARKERS.token);
    expect(out.refresh_token).toBe(REDACTION_MARKERS.token);
    expect(out.client_secret).toBe(REDACTION_MARKERS.token);
  });

  it("recurses into nested objects", () => {
    const out = redactParams({
      headers: {
        Authorization: `Bearer ${SK_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: { foo: "bar" },
    });
    const headers = out.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe(REDACTION_MARKERS.authorization);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(out.body).toEqual({ foo: "bar" });
  });

  it("recurses into arrays", () => {
    const out = redactParams({
      items: [{ apiKey: SK_TOKEN }, { id: "1", apiKey: GHP_TOKEN }],
    });
    const items = out.items as Array<Record<string, unknown>>;
    expect(items[0].apiKey).toBe(REDACTION_MARKERS.token);
    expect(items[1].apiKey).toBe(REDACTION_MARKERS.token);
    expect(items[1].id).toBe("1");
  });

  it("redacts free-form string values when they contain known token patterns", () => {
    const out = redactParams({
      command: `curl -H "Authorization: Bearer ${SK_TOKEN}" https://api.example.com`,
    });
    expect(out.command).not.toContain(SK_TOKEN);
    expect(out.command).toContain("curl");
    expect(out.command).toContain("api.example.com");
  });

  it("redacts URL string values that contain query-string credentials", () => {
    const out = redactParams({
      url: `https://api.example.com/v1?api_key=${SK_TOKEN}&page=1`,
    });
    expect(out.url).not.toContain(SK_TOKEN);
    expect(out.url).toContain("api.example.com");
    expect(out.url).toContain("page=1");
  });

  it("preserves non-sensitive params unchanged", () => {
    const params = { command: "ls -la /tmp", count: 5, recursive: true };
    expect(redactParams(params)).toEqual(params);
  });

  it("handles null and undefined values safely", () => {
    const out = redactParams({ a: null, b: undefined, c: "value" });
    expect(out.a).toBeNull();
    expect(out.b).toBeUndefined();
    expect(out.c).toBe("value");
  });

  it("returns a new object (does not mutate input)", () => {
    const input = { apiKey: SK_TOKEN, nested: { token: GHP_TOKEN } };
    const out = redactParams(input);
    expect(input.apiKey).toBe(SK_TOKEN);
    expect(input.nested.token).toBe(GHP_TOKEN);
    expect(out).not.toBe(input);
    expect(out.nested).not.toBe(input.nested);
  });
});

describe("redactParams — shape preservation", () => {
  it("keeps non-sensitive parts of an exec command readable", () => {
    const out = redactParams({
      command: `curl -H "Authorization: Bearer ${SK_TOKEN}" https://api.example.com/v1/users`,
    });
    const cmd = out.command as string;
    // Useful for triage: still know it was curl hitting api.example.com
    expect(cmd).toMatch(/curl/);
    expect(cmd).toMatch(/Authorization/);
    expect(cmd).toMatch(/api\.example\.com/);
    expect(cmd).toMatch(/<redacted:/);
  });

  it("keeps non-sensitive parts of a URL readable", () => {
    const out = redactParams({
      url: `https://api.example.com/v1/users?token=${GHP_TOKEN}&format=json`,
    });
    const url = out.url as string;
    expect(url).toMatch(/api\.example\.com/);
    expect(url).toMatch(/format=json/);
    expect(url).not.toContain(GHP_TOKEN);
  });
});

describe("REDACTION_MARKERS", () => {
  it("uses stable <redacted:...> shape for all marker kinds", () => {
    expect(REDACTION_MARKERS.token).toMatch(/^<redacted:[a-z-]+>$/);
    expect(REDACTION_MARKERS.authorization).toMatch(/^<redacted:[a-z-]+>$/);
    expect(REDACTION_MARKERS.password).toMatch(/^<redacted:[a-z-]+>$/);
    expect(REDACTION_MARKERS.cookie).toMatch(/^<redacted:[a-z-]+>$/);
    expect(REDACTION_MARKERS.privateKey).toMatch(/^<redacted:[a-z-]+>$/);
    expect(REDACTION_MARKERS.urlCredential).toMatch(/^<redacted:[a-z-]+>$/);
  });
});
