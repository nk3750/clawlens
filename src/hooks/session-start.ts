import type { AuditLogger } from "../audit/logger";
import type { PolicyEngine } from "../policy/engine";
import type { PolicyLoader } from "../policy/loader";
import type { RateLimiter } from "../rate/limiter";
import type { PluginLogger, SessionEvent } from "../types";

export function createSessionStartHandler(
  engine: PolicyEngine,
  _loader: PolicyLoader,
  auditLogger: AuditLogger,
  rateLimiter: RateLimiter,
  logger: PluginLogger,
) {
  return async (_event: SessionEvent, _ctx: unknown): Promise<void> => {
    // Ensure policy is loaded
    if (!engine.getPolicy()) {
      logger.warn("ClawLens: No policy loaded at session start — service may not have started");
    }

    // Ensure audit logger is initialized
    await auditLogger.init();

    // Ensure rate limiter state is loaded
    rateLimiter.restore();

    logger.info("ClawLens: Session started");
  };
}
