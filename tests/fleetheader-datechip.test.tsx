// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DateChip from "../dashboard/src/components/fleetheader/DateChip";

/**
 * Freeze time so todayLocalISO() returns a stable value across test cases.
 * 2026-04-17 (Friday). Past day for retention math: 2026-04-13 = Monday.
 */
function freezeTime() {
  // Fake Date only — leave setTimeout / setInterval real so userEvent's
  // internal scheduling and RTL's findBy* polling don't deadlock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 3, 17, 9, 0, 0));
}

describe("DateChip — chip rendering", () => {
  beforeEach(() => {
    freezeTime();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders TODAY label when selectedDate is null", () => {
    render(<DateChip selectedDate={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { expanded: false })).toHaveTextContent("TODAY");
  });

  it("renders the formatted past-date label when selectedDate is provided", () => {
    render(<DateChip selectedDate="2026-04-13" onChange={vi.fn()} />);
    // "MON, APR 13" per formatDateChipLabel
    const trigger = screen.getByRole("button", { name: /MON, APR 13/i });
    expect(trigger).toBeDefined();
  });

  it("shows the 'Return to today' close button only when viewing a past day", () => {
    const { rerender } = render(<DateChip selectedDate={null} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /return to today/i })).toBeNull();

    rerender(<DateChip selectedDate="2026-04-13" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /return to today/i })).toBeDefined();
  });
});

describe("DateChip — popover open/close", () => {
  beforeEach(() => {
    freezeTime();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the popover dialog when the chip is clicked", async () => {
    // userEvent must use the same fake-timers clock so its internal setTimeouts advance
    const user = userEvent.setup();
    render(<DateChip selectedDate={null} onChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: /TODAY/i }));
    const dialog = await screen.findByRole("dialog", { name: /pick a date/i });
    expect(dialog).toBeDefined();
  });

  it("closes the popover on Escape key", async () => {
    const user = userEvent.setup();
    render(<DateChip selectedDate={null} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /TODAY/i }));
    expect(await screen.findByRole("dialog")).toBeDefined();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("DateChip — quick picks fire callbacks", () => {
  beforeEach(() => {
    freezeTime();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clicking 'Yesterday' calls onChange with the correct ISO", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateChip selectedDate={null} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /TODAY/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Yesterday" }));

    expect(onChange).toHaveBeenCalledWith("2026-04-16");
  });

  it("clicking 'Today' calls onChange(null) so the chip resets to live", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateChip selectedDate="2026-04-13" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /MON, APR 13/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Today" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("DateChip — onRangeChange-conditional shortcuts", () => {
  beforeEach(() => {
    freezeTime();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render the 'Last 7 days' shortcut when onRangeChange is omitted", async () => {
    const user = userEvent.setup();
    render(<DateChip selectedDate={null} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /TODAY/i }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("button", { name: /last 7 days/i })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /last 30 days/i })).toBeNull();
  });

  it("renders the shortcuts and fires both callbacks when onRangeChange is supplied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onRangeChange = vi.fn();
    render(<DateChip selectedDate={null} onChange={onChange} onRangeChange={onRangeChange} />);

    await user.click(screen.getByRole("button", { name: /TODAY/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /last 7 days/i }));

    // Last 7 days: dateOffset=0 (so still today → null) + range="7d"
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onRangeChange).toHaveBeenCalledWith("7d");
  });
});

describe("DateChip — retention boundary disables far-past dates", () => {
  beforeEach(() => {
    freezeTime();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dates older than the retention window have the disabled attribute", async () => {
    const user = userEvent.setup();
    // 3-day retention → only Today / Yesterday / T-2 / T-3 are selectable
    render(<DateChip selectedDate={null} onChange={vi.fn()} retention="3d" />);
    await user.click(screen.getByRole("button", { name: /TODAY/i }));
    const dialog = await screen.findByRole("dialog");

    // The 7-quick-pick row contains 7 buttons; the last three should be disabled.
    const quickPickArea = within(dialog).getByLabelText("Quick pick");
    const quickButtons = within(quickPickArea).getAllByRole("button");
    expect(quickButtons).toHaveLength(7);
    expect(quickButtons[0]).not.toBeDisabled();
    expect(quickButtons[3]).not.toBeDisabled();
    expect(quickButtons[4]).toBeDisabled();
    expect(quickButtons[5]).toBeDisabled();
    expect(quickButtons[6]).toBeDisabled();
  });
});
