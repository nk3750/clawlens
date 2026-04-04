import { useEffect, useRef } from "react";

const BASE = "/plugins/clawlens";

export function useSSE<T>(path: string, onMessage: (data: T) => void) {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
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
