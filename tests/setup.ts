import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * jsdom has no layout, so it implements neither of these. The narrow-width nav
 * needs both: it asks whether the bar layout is in effect, then brings the
 * current screen's item into the scrolling row (#83).
 *
 * `matches: false` is the desktop answer, which is what most tests want — a test
 * about the narrow layout overrides it. Both are cleared between tests so a
 * spy's call history cannot leak.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => vi.clearAllMocks());

afterEach(() => cleanup());
