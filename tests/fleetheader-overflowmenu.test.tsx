// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OverflowMenu from "../dashboard/src/components/fleetheader/OverflowMenu";

/** Wrap in a MemoryRouter so the <Link to="/guardrails"> renders without throwing. */
function renderMenu(props: Partial<React.ComponentProps<typeof OverflowMenu>> = {}) {
  return render(
    <MemoryRouter>
      <OverflowMenu
        guardrailCount={props.guardrailCount ?? 3}
        selectedDate={props.selectedDate ?? null}
        rangeParam={props.rangeParam ?? "12h"}
      />
    </MemoryRouter>,
  );
}

describe("OverflowMenu — open / close", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 3, 17, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the trigger button collapsed by default", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the menu when the trigger is clicked", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes the menu on Escape", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu on a click outside", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <div>
          <OverflowMenu guardrailCount={2} selectedDate={null} rangeParam="12h" />
          <button type="button" data-testid="outside">
            outside
          </button>
        </div>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("OverflowMenu — keyboard navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 3, 17, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("focuses the first menu item on open and cycles with ArrowDown / ArrowUp", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /more actions/i }));

    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    // The disabled "Generate report" item should not receive initial focus.
    expect(items[0]).toHaveTextContent(/view guardrails/i);
    expect(document.activeElement).toBe(items[0]);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[2]);

    // ArrowUp wraps backward through the focusable items.
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(items[1]);
  });
});

describe("OverflowMenu — Copy digest link", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 3, 17, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("invokes navigator.clipboard.writeText with a URL containing the current range", async () => {
    // userEvent.setup() installs a Clipboard mock on navigator if jsdom lacks
    // one — exposed as navigator.clipboard. Spy on it before the click.
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    renderMenu({ selectedDate: null, rangeParam: "6h" });
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /copy digest link/i }));

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    const url = String(writeTextSpy.mock.calls[0][0]);
    expect(url).toContain("range=6h");
  });

  it("includes a date param when viewing a past day", async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    renderMenu({ selectedDate: "2026-04-13", rangeParam: "24h" });
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /copy digest link/i }));

    const url = String(writeTextSpy.mock.calls[0][0]);
    expect(url).toContain("date=2026-04-13");
    expect(url).toContain("range=24h");
  });
});

describe("OverflowMenu — disabled placeholder", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 3, 17, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders 'Generate report' with aria-disabled='true' and 'soon' label", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /more actions/i }));

    const menu = screen.getByRole("menu");
    const generate = within(menu)
      .getByText(/generate report/i)
      .closest("[role='menuitem']");
    expect(generate).not.toBeNull();
    expect(generate).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByText("soon")).toBeInTheDocument();
  });
});

describe("OverflowMenu — export link", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 3, 17, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses today as the export date when selectedDate is null", async () => {
    const user = userEvent.setup();
    renderMenu({ selectedDate: null });
    await user.click(screen.getByRole("button", { name: /more actions/i }));

    const link = screen.getByRole("menuitem", { name: /export audit log/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("date=2026-04-17");
  });

  it("uses the selected past date when present", async () => {
    const user = userEvent.setup();
    renderMenu({ selectedDate: "2026-04-13" });
    await user.click(screen.getByRole("button", { name: /more actions/i }));

    const link = screen.getByRole("menuitem", { name: /export audit log/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("date=2026-04-13");
  });
});
