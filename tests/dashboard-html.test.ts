import { describe, it, expect } from "vitest";
import { getDashboardHtml } from "../src/dashboard/html";

describe("getDashboardHtml", () => {
  const html = getDashboardHtml();

  it("returns a non-empty string", () => {
    expect(html).toBeTruthy();
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("is a valid HTML document", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
  });

  it("includes the ClawLens branding", () => {
    expect(html).toContain("ClawLens");
    expect(html).toContain("Dashboard");
  });

  it("has viewport meta tag for mobile", () => {
    expect(html).toContain('name="viewport"');
    expect(html).toContain("width=device-width");
  });

  it("contains summary card section with stat elements", () => {
    expect(html).toContain("stat-grid");
    expect(html).toContain("val-allowed");
    expect(html).toContain("val-approved");
    expect(html).toContain("val-blocked");
    expect(html).toContain("val-timedout");
  });

  it("contains callout badges container", () => {
    expect(html).toContain('id="callouts"');
  });

  it("contains activity feed section", () => {
    expect(html).toContain("Recent Activity");
    expect(html).toContain('id="activity-feed"');
  });

  it("contains load more button", () => {
    expect(html).toContain("load-more");
    expect(html).toContain("Load more");
  });

  it("contains footer for hash chain integrity", () => {
    expect(html).toContain("<footer");
    expect(html).toContain("audit");
  });

  it("contains refresh button", () => {
    expect(html).toContain("refresh-btn");
    expect(html).toContain("Refresh");
  });

  it("has embedded CSS (no external stylesheets)", () => {
    expect(html).toContain("<style>");
    expect(html).toContain("</style>");
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });

  it("has embedded JS (no external scripts)", () => {
    expect(html).toContain("<script>");
    expect(html).toContain("</script>");
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("references the API endpoints in JS", () => {
    expect(html).toContain("/api/stats");
    expect(html).toContain("/api/entries");
    expect(html).toContain("/api/health");
  });

  it("includes responsive CSS for mobile", () => {
    expect(html).toContain("@media");
    expect(html).toContain("640px");
  });

  it("uses the dark theme colors", () => {
    expect(html).toContain("#0e1015"); // page bg
    expect(html).toContain("#ff5c5c"); // accent
  });

  it("handles empty state in JS", () => {
    expect(html).toContain("No activity recorded yet");
  });
});
