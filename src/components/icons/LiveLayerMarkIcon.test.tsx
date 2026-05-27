// Coverage for the brand-mark icon used in the idle header. Light-touch
// tests — the icon is a pure presentational component, but the contract
// matters: same paths as components/brand/LiveLayerLogo.tsx in the main
// dashboard (single source of truth for the brand mark), aria-hidden by
// default (the surrounding "Live Layer" wordmark carries the
// accessible name), and resilient to a `fill` override for future
// monochrome variants.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LiveLayerMarkIcon } from "./LiveLayerMarkIcon";

describe("LiveLayerMarkIcon", () => {
  it("renders as an SVG at the default 14×14 size", () => {
    const { container } = render(<LiveLayerMarkIcon />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("14");
    expect(svg?.getAttribute("height")).toBe("14");
  });

  it("paints in LiveLayer orange (#E06540) by default", () => {
    const { container } = render(<LiveLayerMarkIcon />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
    for (const p of Array.from(paths)) {
      expect(p.getAttribute("fill")?.toLowerCase()).toBe("#e06540");
    }
  });

  it("accepts a fill override (for future monochrome variants — keep this contract stable)", () => {
    const { container } = render(<LiveLayerMarkIcon fill="#ffffff" />);
    const paths = container.querySelectorAll("path");
    for (const p of Array.from(paths)) {
      expect(p.getAttribute("fill")?.toLowerCase()).toBe("#ffffff");
    }
  });

  it("is aria-hidden so the surrounding wordmark text carries the accessible name", () => {
    const { container } = render(<LiveLayerMarkIcon />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("respects a custom size prop", () => {
    const { container } = render(<LiveLayerMarkIcon size={24} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.getAttribute("height")).toBe("24");
  });
});
