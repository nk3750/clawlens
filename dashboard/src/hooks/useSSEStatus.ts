import { useEffect, useState } from "react";
import { createSSEStatusManager, type SSEStatus } from "../lib/sseStatus";

const BASE = "/plugins/clawlens";

/**
 * Reports the liveness of the ClawLens SSE stream — "live" when connected,
 * "reconnecting" during backoff, "offline" after repeated failures.
 *
 * Opens its own EventSource rather than reaching into the existing useSSE hook
 * because useSSE has no status surface today and refactoring every caller is
 * out of scope for Phase A (see homepage-v3-layout-spec §6).
 */
export function useSSEStatus(path = "api/stream"): SSEStatus {
  const [status, setStatus] = useState<SSEStatus>("reconnecting");

  useEffect(() => {
    const manager = createSSEStatusManager({
      url: `${BASE}/${path}`,
      onChange: setStatus,
    });
    return () => manager.close();
  }, [path]);

  return status;
}
