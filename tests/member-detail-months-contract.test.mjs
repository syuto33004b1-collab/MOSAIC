import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #437. The member detail line is 12 months wide and scrolls for the rest.
 * At the two-pane breakpoint the left pane itself does not scroll; the
 * assignment list does. The right pane keeps its own scroll.
 */

const read = (name) => readFile(path.join(root, name), "utf8");

test("the two-pane member load pane scrolls only the assignment list", async () => {
  const css = await read("src/styles.css");
  const media = css.slice(css.indexOf("@media (min-width: 1052px) and (min-height: 720px)"));
  const load = media.match(/\.member-detail-load \{([^}]+)\}/u);
  const list = media.match(/\.member-detail-assignments \{([^}]+)\}/u);
  const who = media.match(/\.member-detail-who \{([^}]+)\}/u);
  assert.ok(load, "the two-pane query no longer styles .member-detail-load");
  assert.ok(list, "the two-pane query no longer styles .member-detail-assignments");
  assert.ok(who, "the two-pane query no longer styles .member-detail-who");
  assert.match(load[1], /overflow:\s*hidden/u);
  assert.match(load[1], /display:\s*flex/u);
  assert.match(list[1], /overflow:\s*auto/u);
  assert.match(who[1], /overflow:\s*auto/u);
});

test("the hero sentence wraps at the text floor", async () => {
  const css = await read("src/styles.css");
  const rule = css.match(/\.member-detail \.profile-hero > strong \{([^}]+)\}/u);
  assert.ok(rule, "the member hero sentence has no override");
  assert.match(rule[1], /font-size:\s*var\(--text-min\)/u);
  assert.match(rule[1], /white-space:\s*normal/u);
  assert.doesNotMatch(rule[1], /nowrap/u);
});

test("the month track is one twelfth of the scroller per month", async () => {
  const app = await read("src/App.tsx");
  assert.match(app, /calc\(100% \* var\(--month-count\) \/ 12\)/u);
  assert.match(app, /memberMonthScrollLeft\(basisIndex, node\.clientWidth\)/u);
  assert.match(app, /vectorEffect="non-scaling-stroke"/u);
  assert.match(app, /preserveAspectRatio="none"/u);
});
