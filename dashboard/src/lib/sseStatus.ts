export type SSEStatus = "live" | "reconnecting" | "offline";

/**
 * Minimal surface we need from an EventSource. Keeping this local means the
 * manager is trivial to unit-test with an in-memory stand-in (no jsdom).
 */
export interface EventSourceLike {
  close(): void;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export type CancelFn = () => void;
export type Scheduler = (fn: () => void, ms: number) => CancelFn;

export interface SSEStatusManagerOptions {
  url: string;
  onChange: (status: SSEStatus) => void;
  /** Override for tests / non-browser runtimes. */
  eventSourceFactory?: EventSourceFactory;
  /** Override for tests. Default: setTimeout / clearTimeout. */
  schedule?: Scheduler;
  /** Consecutive failures before giving up. Default: 3. */
  maxFailures?: number;
  /** Backoff before retrying after a failure. Default: 2000ms. */
  backoffMs?: number;
}

export interface SSEStatusManager {
  close(): void;
  getStatus(): SSEStatus;
  /** Total consecutive failures since the last successful open. Test-only. */
  _failures(): number;
}

const defaultSchedule: Scheduler = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

const defaultFactory: EventSourceFactory = (url) => {
  if (typeof EventSource === "undefined") {
    throw new Error("EventSource is not available in this runtime");
  }
  return new EventSource(url) as EventSourceLike;
};

/**
 * Observes an SSE connection and emits "live" / "reconnecting" / "offline"
 * state transitions. The manager owns its own EventSource — we don't refactor
 * the existing useSSE hook because its callers don't currently surface status
 * and another EventSource per client is cheap.
 */
export function createSSEStatusManager(opts: SSEStatusManagerOptions): SSEStatusManager {
  const factory = opts.eventSourceFactory ?? defaultFactory;
  const schedule = opts.schedule ?? defaultSchedule;
  const maxFailures = opts.maxFailures ?? 3;
  const backoffMs = opts.backoffMs ?? 2000;

  let status: SSEStatus = "reconnecting";
  let failures = 0;
  let source: EventSourceLike | null = null;
  let cancelPending: CancelFn | null = null;
  let closed = false;

  function setStatus(next: SSEStatus): void {
    if (status === next) return;
    status = next;
    opts.onChange(status);
  }

  function connect(): void {
    if (closed) return;
    source = factory(opts.url);
    source.onopen = () => {
      if (closed) return;
      failures = 0;
      setStatus("live");
    };
    source.onerror = () => {
      if (closed) return;
      failures += 1;
      try {
        source?.close();
      } catch {
        /* ignore close errors */
      }
      source = null;
      if (failures >= maxFailures) {
        setStatus("offline");
        return;
      }
      setStatus("reconnecting");
      cancelPending = schedule(() => {
        cancelPending = null;
        connect();
      }, backoffMs);
    };
  }

  // Kick off the first connection synchronously.
  connect();

  return {
    close() {
      closed = true;
      if (cancelPending) {
        cancelPending();
        cancelPending = null;
      }
      try {
        source?.close();
      } catch {
        /* ignore */
      }
      source = null;
    },
    getStatus() {
      return status;
    },
    _failures() {
      return failures;
    },
  };
}
