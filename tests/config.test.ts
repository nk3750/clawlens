import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config";

describe("DEFAULT_CONFIG — local-safe baseline (v1.0.1)", () => {
  it("defaults risk.llmEnabled to false", () => {
    expect(DEFAULT_CONFIG.risk.llmEnabled).toBe(false);
  });

  it("defaults alerts.enabled to false", () => {
    expect(DEFAULT_CONFIG.alerts.enabled).toBe(false);
  });

  it("does not expose llmApiKeyEnv as an active runtime field", () => {
    expect(DEFAULT_CONFIG.risk).not.toHaveProperty("llmApiKeyEnv");
  });

  it("does not expose llmProvider as an active runtime field", () => {
    expect(DEFAULT_CONFIG.risk).not.toHaveProperty("llmProvider");
  });

  it("does not expose llmModel as an active runtime field", () => {
    expect(DEFAULT_CONFIG.risk).not.toHaveProperty("llmModel");
  });

  it("keeps llmEvalThreshold for opt-in LLM evaluation", () => {
    expect(DEFAULT_CONFIG.risk.llmEvalThreshold).toBe(50);
  });

  it("defaults alerts.includeParamValues to false", () => {
    expect(DEFAULT_CONFIG.alerts.includeParamValues).toBe(false);
  });
});

describe("resolveConfig — legacy LLM-config compatibility", () => {
  it("does not throw when legacy llmApiKeyEnv/llmProvider/llmModel are present", () => {
    expect(() =>
      resolveConfig({
        risk: { llmApiKeyEnv: "ANTHROPIC_API_KEY", llmProvider: "anthropic", llmModel: "x" },
      }),
    ).not.toThrow();
  });

  it("strips legacy llmApiKeyEnv from the runtime config", () => {
    const cfg = resolveConfig({
      risk: { llmApiKeyEnv: "ANTHROPIC_API_KEY", llmProvider: "anthropic", llmModel: "x" },
    });
    expect(cfg.risk).not.toHaveProperty("llmApiKeyEnv");
    expect(cfg.risk).not.toHaveProperty("llmProvider");
    expect(cfg.risk).not.toHaveProperty("llmModel");
  });

  it("keeps llmEnabled honored when set by the user", () => {
    const cfg = resolveConfig({ risk: { llmEnabled: true } });
    expect(cfg.risk.llmEnabled).toBe(true);
  });

  it("keeps llmEvalThreshold honored when set by the user", () => {
    const cfg = resolveConfig({ risk: { llmEvalThreshold: 70 } });
    expect(cfg.risk.llmEvalThreshold).toBe(70);
  });

  it("honors alerts.includeParamValues=true when set explicitly", () => {
    const cfg = resolveConfig({ alerts: { includeParamValues: true } });
    expect(cfg.alerts.includeParamValues).toBe(true);
  });

  it("returns local-safe defaults when no plugin config is supplied", () => {
    const cfg = resolveConfig(undefined);
    expect(cfg.risk.llmEnabled).toBe(false);
    expect(cfg.alerts.enabled).toBe(false);
    expect(cfg.alerts.includeParamValues).toBe(false);
  });
});
