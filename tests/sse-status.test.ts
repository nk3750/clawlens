import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSSEStatusManager,
  type EventSourceLike,
  type Scheduler,
  type SSEStatus,
} from "../dashboard/src/lib/sseStatus";

/**
 * Deterministic EventSource stand-in: records construction, exposes
 * fireOpen()/fireError() for the test to drive state transitions, and tracks
 * close() calls.
 */
class FakeEventSource implements EventSourceLike {
  url: string;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
  }

  close(): void {
    this.closed = true;
  }

  fireOpen(): void {
    this.onopen?.(new Event("open"));
  }

  fireError(): void {
    this.onerror?.(new Event("error"));
  }
}

interface ScheduledJob {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

function createControllableScheduler(): {
  scheduler: Scheduler;
  jobs: ScheduledJob[];
  runNext: () => void;
  pendingCount: () => number;
} {
  const jobs: ScheduledJob[] = [];
  const scheduler: Scheduler = (fn, ms) => {
    const job: ScheduledJob = { fn, ms, cancelled: false };
    jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  };
  function runNext() {
    const next = jobs.find((j) => !j.cancelled);
    if (!next) throw new Error("runNext: no pending jobs");
    next.cancelled = true;
    next.fn();
  }
  function pendingCount() {
    return jobs.filter((j) => !j.cancelled).length;
  }
  return { scheduler, jobs, runNext, pendingCount };
}

function factorySpy(sources: FakeEventSource[]) {
  return (url: string) => {
    const fake = new FakeEventSource(url);
    sources.push(fake);
    return fake;
  };
}

describe("createSSEStatusManager — initial state", () => {
  it("constructs an EventSource eagerly and starts in 'reconnecting'", () => {
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: () => () => {},
      onChange,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("/x");
    expect(mgr.getStatus()).toBe("reconnecting");
    expect(onChange).not.toHaveBeenCalled(); // no transition yet
    mgr.close();
  });
});

describe("createSSEStatusManager — onopen transition", () => {
  it("emits 'live' on first onopen", () => {
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: () => () => {},
      onChange,
    });

    sources[0].fireOpen();
    expect(mgr.getStatus()).toBe("live");
    expect(onChange).toHaveBeenCalledWith("live");
    expect(onChange).toHaveBeenCalledTimes(1);
    mgr.close();
  });

  it("does not re-emit when already 'live' (idempotent setStatus)", () => {
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: () => () => {},
      onChange,
    });

    sources[0].fireOpen();
    sources[0].fireOpen();
    expect(onChange).toHaveBeenCalledTimes(1);
    mgr.close();
  });
});

describe("createSSEStatusManager — error & backoff", () => {
  let ctl: ReturnType<typeof createControllableScheduler>;

  beforeEach(() => {
    ctl = createControllableScheduler();
  });

  it("transitions to 'reconnecting' on error before maxFailures", () => {
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange,
    });

    // Internal status starts as "reconnecting"; firing an error before a
    // successful open increments failures but the status stays the same, so
    // onChange is not called — we only assert the scheduled reconnect.
    sources[0].fireError();
    expect(sources[0].closed).toBe(true);
    expect(ctl.pendingCount()).toBe(1);
    expect(ctl.jobs[0].ms).toBe(2000);
    expect(mgr._failures()).toBe(1);
    mgr.close();
  });

  it("flips live → reconnecting when a connected stream errors", () => {
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange,
    });

    sources[0].fireOpen();
    expect(mgr.getStatus()).toBe("live");

    sources[0].fireError();
    expect(mgr.getStatus()).toBe("reconnecting");
    expect(onChange).toHaveBeenLastCalledWith("reconnecting");
    mgr.close();
  });

  it("reopens a new EventSource after backoff elapses", () => {
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange,
    });

    sources[0].fireError();
    expect(sources).toHaveLength(1);

    ctl.runNext();
    expect(sources).toHaveLength(2);
    expect(sources[1].url).toBe("/x");
    mgr.close();
  });

  it("resets failure count on a successful reconnect", () => {
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange,
      maxFailures: 3,
    });

    sources[0].fireError();
    expect(mgr._failures()).toBe(1);

    ctl.runNext();
    sources[1].fireOpen();

    expect(mgr.getStatus()).toBe("live");
    expect(mgr._failures()).toBe(0);
    mgr.close();
  });

  it("honors custom backoffMs", () => {
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange,
      backoffMs: 500,
    });

    sources[0].fireError();
    expect(ctl.jobs[0].ms).toBe(500);
    mgr.close();
  });
});

describe("createSSEStatusManager — offline terminal state", () => {
  it("transitions to 'offline' after maxFailures consecutive errors", () => {
    const ctl = createControllableScheduler();
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange,
      maxFailures: 3,
    });

    // Failure 1 — reconnect scheduled
    sources[0].fireError();
    ctl.runNext();

    // Failure 2 — reconnect scheduled
    sources[1].fireError();
    ctl.runNext();

    // Failure 3 — should go offline, NO further reconnect
    sources[2].fireError();

    expect(mgr.getStatus()).toBe("offline");
    expect(onChange).toHaveBeenLastCalledWith("offline");
    expect(ctl.pendingCount()).toBe(0);
    expect(sources).toHaveLength(3);
    mgr.close();
  });

  it("respects a custom maxFailures value", () => {
    const ctl = createControllableScheduler();
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange,
      maxFailures: 1,
    });

    sources[0].fireError();
    expect(mgr.getStatus()).toBe("offline");
    expect(ctl.pendingCount()).toBe(0);
    mgr.close();
  });
});

describe("createSSEStatusManager — close()", () => {
  it("cancels a pending reconnect and closes the active source", () => {
    const ctl = createControllableScheduler();
    const sources: FakeEventSource[] = [];
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange: vi.fn(),
    });

    sources[0].fireError();
    expect(ctl.pendingCount()).toBe(1);
    mgr.close();

    expect(ctl.pendingCount()).toBe(0);
    expect(sources[0].closed).toBe(true);
  });

  it("suppresses late onopen after close()", () => {
    const ctl = createControllableScheduler();
    const sources: FakeEventSource[] = [];
    const onChange = vi.fn<(s: SSEStatus) => void>();
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange,
    });

    mgr.close();
    sources[0].fireOpen();
    expect(mgr.getStatus()).toBe("reconnecting");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("suppresses late onerror after close() and does not schedule a reconnect", () => {
    const ctl = createControllableScheduler();
    const sources: FakeEventSource[] = [];
    const mgr = createSSEStatusManager({
      url: "/x",
      eventSourceFactory: factorySpy(sources),
      schedule: ctl.scheduler,
      onChange: vi.fn(),
    });

    mgr.close();
    sources[0].fireError();
    expect(ctl.pendingCount()).toBe(0);
  });
});
