// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Sparkline from "../dashboard/src/components/guardrails/Sparkline";

describe("Sparkline", () => {
  it("renders an svg with a polyline for non-empty values", () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} color="red" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("polyline")).not.toBeNull();
  });

  it("does not crash on an empty array (renders flat baseline)", () => {
    const { container } = render(<Sparkline values={[]} color="red" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("does not crash on all-zero values (max clamped to 1)", () => {
    const { container } = render(<Sparkline values={[0, 0, 0, 0]} color="red" />);
    expect(container.querySelector("polyline")).not.toBeNull();
  });

  it("uses default width 60 / height 14 when not provided", () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} color="red" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("60");
    expect(svg?.getAttribute("height")).toBe("14");
  });

  it("respects custom width and height", () => {
    const { container } = render(
      <Sparkline values={[1, 2, 3]} color="red" width={180} height={32} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("180");
    expect(svg?.getAttribute("height")).toBe("32");
  });

  it("applies the supplied color to the polyline stroke", () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} color="#abcdef" />);
    expect(container.querySelector("polyline")?.getAttribute("stroke")).toBe("#abcdef");
  });
});
