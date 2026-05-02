// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import VerbChip from "../dashboard/src/components/guardrails/VerbChip";

describe("VerbChip", () => {
  it("renders the verb in uppercase", () => {
    render(<VerbChip verb="write" on={false} />);
    expect(screen.getByText("WRITE")).toBeInTheDocument();
  });

  it("calls onClick when clicked (when not disabled)", () => {
    const onClick = vi.fn();
    render(<VerbChip verb="write" on={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(<VerbChip verb="write" on={false} onClick={onClick} disabled hint="locked" />);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("sets the title attribute to the hint when disabled", () => {
    render(<VerbChip verb="write" on={false} disabled hint="please-no" />);
    expect(screen.getByRole("button").getAttribute("title")).toBe("please-no");
  });

  it("renders a leading dot when on=true (visual on-state marker)", () => {
    const { container } = render(<VerbChip verb="write" on={true} />);
    // A child span with aria-hidden serves as the on-state dot.
    expect(container.querySelector("span[aria-hidden]")).not.toBeNull();
  });

  it("does NOT render the leading dot when on=false", () => {
    const { container } = render(<VerbChip verb="write" on={false} />);
    expect(container.querySelector("span[aria-hidden]")).toBeNull();
  });
});
