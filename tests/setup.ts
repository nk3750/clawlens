// Vitest setup file — runs once per test process, before any test file.
//
// 1. Imports the jest-dom matchers for use in jsdom .tsx tests
//    (e.g., toBeDisabled, toBeInTheDocument, toHaveTextContent).
//    The extension is harmless in node-environment tests; vitest's expect just
//    gains extra matchers they happen not to call.
// 2. Registers an explicit RTL cleanup() hook so portals (DateChip popover,
//    OverflowMenu dropdown) don't leak between tests. RTL's auto-cleanup is
//    skipped here because we don't enable vitest's `globals` option, which is
//    what RTL keys off when auto-registering its own afterEach.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
