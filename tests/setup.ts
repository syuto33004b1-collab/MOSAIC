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

/**
 * デモデータ（src/domain.ts）の日付は2026年8月の絶対日付で固定されている。対して
 * テストは `getWeekStart(0)` などで実時刻の「今週」を組み立てるので、時計が8月から
 * 出た瞬間に両者が食い違う。2026-09-01 に差分なしで main が赤くなった（#235）。
 *
 * そこでテストの「いま」を1点に固定する。止めるのは日付だけで、タイマーは実物のまま
 * にする。`vi.setSystemTime` は fake timer を有効にしなくても Date を固定できるので、
 * `vi.isFakeTimers()` は false のまま（実測）。Testing Library や userEvent が
 * 「fake timer が入っている」と判断して待ち方を変えることがない。
 *
 * モジュール先頭で固定するのは、`const weekStart = getWeekStart(0)` のようなモジュール
 * 定数が import 時（= beforeEach より前）に評価されるため。beforeEach だけでは、実時刻
 * の週で作った fixture を固定時刻の画面と突き合わせることになる。
 */
const TEST_NOW = new Date("2026-08-19T09:00:00+09:00");
const pinClock = () => {
  // 自前でタイマーを進めるテストの後始末も兼ねる。解除してから日付だけ入れ直す。
  vi.useRealTimers();
  vi.setSystemTime(TEST_NOW);
};

pinClock();

beforeEach(() => {
  vi.clearAllMocks();
  // 自前で `vi.useRealTimers()` するテストがあるので、毎回入れ直す。
  pinClock();
});

afterEach(() => cleanup());
