import { useEffect, useRef } from "react";

const BASE = "/plugins/clawlens";

/**
 * Subscribe to an SSE endpoint. Pass `null` as `path` to skip the
 * subscription entirely — useful when the caller wants to conditionally
 * stream (e.g. only on today views).
 */
export function useSSE<T>(path: string | null, onMessage: (data: T) => void) {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    if (path === null) return;
    const source = new EventSource(`${BASE}/${path}`);

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as T;
        callbackRef.current(data);
      } catch {
        // ignore malformed events
      }
    };

    return () => source.close();
  }, [path]);
}
