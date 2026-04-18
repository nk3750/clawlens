// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResolveButtons from "../dashboard/src/components/attention/ResolveButtons";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ResolveButtons — happy path", () => {
  it("posts approve to /api/attention/resolve with the toolCallId", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", mockFetch);

    render(<ResolveButtons toolCallId="tc_42" />);
    await user.click(screen.getByRole("button", { name: /Approve/i }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/plugins/clawlens/api/attention/resolve");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ toolCallId: "tc_42", decision: "approve" });
  });

  it("posts deny with the correct body", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", mockFetch);

    render(<ResolveButtons toolCallId="tc_xyz" />);
    await user.click(screen.getByRole("button", { name: /Deny/i }));

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.decision).toBe("deny");
  });
});

describe("ResolveButtons — race / error handling", () => {
  it("shows 'Already resolved' on a 404 response (race with Telegram)", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    vi.stubGlobal("fetch", mockFetch);

    render(<ResolveButtons toolCallId="tc_race" />);
    await user.click(screen.getByRole("button", { name: /Approve/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Already resolved/i);
  });

  it("shows a generic 'HTTP 500' message when the server errors", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    vi.stubGlobal("fetch", mockFetch);

    render(<ResolveButtons toolCallId="tc_err" />);
    await user.click(screen.getByRole("button", { name: /Deny/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/HTTP 500/);
  });

  it("shows 'Failed' when fetch itself throws (network error)", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", mockFetch);

    render(<ResolveButtons toolCallId="tc_net" />);
    await user.click(screen.getByRole("button", { name: /Approve/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/network down/i);
  });
});

describe("ResolveButtons — disabled", () => {
  it("does not POST when disabled=true", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", mockFetch);

    render(<ResolveButtons toolCallId="tc_x" disabled />);
    await user.click(screen.getByRole("button", { name: /Approve/i }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("marks both buttons as disabled in the DOM when disabled=true", () => {
    render(<ResolveButtons toolCallId="tc_x" disabled />);
    expect(screen.getByRole("button", { name: /Approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Deny/i })).toBeDisabled();
  });
});

describe("ResolveButtons — click noise", () => {
  it("rapid double-click only fires a single POST", async () => {
    const user = userEvent.setup();
    // Hold the promise open so the second click arrives while busy=true.
    let resolver: ((value: Response) => void) | null = null;
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolver = r;
        }),
    );
    vi.stubGlobal("fetch", mockFetch);

    render(<ResolveButtons toolCallId="tc_double" />);
    const approve = screen.getByRole("button", { name: /Approve/i });
    await user.click(approve);
    await user.click(approve);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Release the first fetch so React can flush and the test finishes cleanly.
    resolver?.({ ok: true, status: 200 } as Response);
  });
});
