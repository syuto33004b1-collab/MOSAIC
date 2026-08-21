import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * jsdom has no layout, so it does not implement `scrollIntoView`. The narrow-width
 * nav calls it to bring the current screen's item into the scrolling row (#83).
 * A stub rather than a no-op assignment: a test can then assert it was called.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

afterEach(() => cleanup());
