import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #135: the notification popover was unreadable on all nine screens. Only its
 * top 20px showed; the ribbon or the toolbar had the rest of it.
 *
 * It carries `z-index: 30`, and that meant nothing, because `.topbar` was a
 * stacking context: 30 could only order the popover against its siblings inside
 * the topbar, and `.section-view`, painted later, went over the whole thing.
 *
 * `.topbar` was a stacking context because of `animation: rise-in ... both`. A
 * forwards fill keeps the animation in effect after it has finished, and an
 * `opacity` or `transform` animation that is in effect creates a stacking
 * context. Measured by rebuilding `rise-in` three ways, each one loaded as
 * static CSS with `.topbar` put back on `both`:
 *
 * | `rise-in` animates | `.topbar` computed transform | popover |
 * | ------------------ | ---------------------------- | ------- |
 * | opacity, transform | `matrix(1,0,0,1,0,0)`        | buried  |
 * | opacity only       | `none`                       | buried  |
 * | transform only     | `matrix(1,0,0,1,0,0)`        | buried  |
 *
 * Either property alone is enough. Row two is the informative one: the computed
 * transform is `none` and the popover is still buried, so it is not the residual
 * value that creates the context. That also explains two probes that did nothing
 * — `.topbar { transform: none !important }` and
 * `.notification-popover { z-index: 999 }` both left it buried.
 *
 * ## What this is
 *
 * A conservative lexical guard, not a CSS parser: no rule may give a forwards
 * fill (`both` or `forwards`) to an animation whose keyframes touch `opacity` or
 * `transform` — the two properties the measurement covers.
 *
 * Today that is every keyframe in the file, so a bare `animation-fill-mode`
 * longhand is flagged wherever it appears rather than resolved back to a keyframe
 * name, which a regex cannot do. If a keyframe is ever added that animates
 * neither property, a `forwards` fill on it is fine and this test has to learn
 * the difference.
 *
 * Being lexical, it reads text and not cascade: a value assembled through
 * `var()`, several animations on one element paired with several fill modes by
 * position, a property name inside a string, and `@supports` are all beyond it.
 *
 * ## What this is not
 *
 * **It does not prove the popover is on top.** That is a browser measurement,
 * recorded in the PR: the popover's own rect probed at three points with
 * `elementFromPoint`, on every screen and at three widths.
 *
 * Nor does it cover the other ways an element becomes a stacking context. An
 * `infinite` animation is in effect forever too, so `sync-pulse`,
 * `production-spin` and `ai-chat-spin` are stacking contexts as well — they are
 * left alone because they run on leaf elements (a status dot, a spinner glyph)
 * with nothing inside them to trap. That "leaf" is an observation about today's
 * markup, not something this file checks. `filter`, `backdrop-filter`,
 * `mix-blend-mode`, `will-change`, `contain`, `opacity` below 1 and
 * `position: fixed` all create one as well, and none of them are checked here.
 * Neither is the window while an animation is genuinely running, when the
 * element is a stacking context whatever its fill mode says.
 */

const read = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");

/** Comments come out first: the prose above and in the stylesheet says `both`. */
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** Keyframe names whose body declares `opacity` or `transform`. */
function contextMakingKeyframes(css) {
  const names = new Set();
  for (const [, name, body] of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/gu)) {
    if (/(?:^|[;{\s])(?:opacity|transform)\s*:/iu.test(body)) names.add(name);
  }
  return names;
}

/**
 * `animation`, and the vendor-prefixed spellings, but not `--animation` — a
 * custom property is not a declaration of this. The name is not assumed to come
 * first in the value, and `animation :` with a space is still `animation`.
 */
const ANIMATION_DECLARATION = /(?<![-\w])(?:-(?:webkit|moz|ms|o)-)?animation\s*:[^;}]*/giu;
const FILL_MODE_DECLARATION = /(?<![-\w])(?:-(?:webkit|moz|ms|o)-)?animation-fill-mode\s*:\s*[^;}]+/giu;
const FORWARDS_FILL = /(?<![\w-])(both|forwards)(?![\w-])/iu;

test("no opacity or transform animation keeps a forwards fill", async () => {
  const css = withoutComments(await read());
  const contextMaking = contextMakingKeyframes(css);
  assert.ok(contextMaking.has("rise-in"), "expected rise-in among the keyframes that animate opacity or transform");

  const offenders = [];
  for (const [whole] of css.matchAll(ANIMATION_DECLARATION)) {
    const fill = whole.match(FORWARDS_FILL);
    // A shorthand carries its animation's name, so this side can at least be
    // narrowed to the keyframes that matter.
    const named = [...contextMaking].filter((name) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`, "u").test(whole));
    if (fill && named.length > 0) offenders.push(`${whole.trim().slice(0, 76)}  => ${fill[1]}`);
  }
  for (const [whole] of css.matchAll(FILL_MODE_DECLARATION)) {
    if (FORWARDS_FILL.test(whole)) offenders.push(whole.trim());
  }

  assert.deepEqual(offenders, [], "a forwards fill keeps the animation in effect, and an opacity or transform "
    + `animation in effect makes its element a stacking context (#135):\n  ${offenders.join("\n  ")}`);
});

/**
 * The other half of #135. With the fill gone, `z-index: 30` is what actually
 * puts the popover over `.portfolio-ribbon`, `.member-ribbon` and the toolbars,
 * which are positioned and would otherwise paint later.
 */
test("the notification popover still declares a stack position", async () => {
  const css = withoutComments(await read());
  const rule = css.match(/\.notification-popover\s*\{([^}]*)\}/u);
  assert.ok(rule, ".notification-popover rule not found");
  const z = rule[1].match(/z-index:\s*(\d+)/u);
  assert.ok(z, "the popover needs a z-index; the elements it covers are positioned");
  assert.ok(Number(z[1]) > 1, `z-index is ${z[1]}; the ribbons' own children sit at 1`);
});

/**
 * And the belt to that brace. For the 0.45s `rise-in` is genuinely running,
 * `.topbar` is a stacking context whatever its fill mode says, and a click on the
 * bell inside that window put the popover back under `.pulse-strip` — measured,
 * not assumed. A stack position on `.topbar` itself lifts the whole thing above
 * the content, so the popover reads whether or not it is trapped.
 *
 * The ceiling matters as much as the floor: above 40 it would start covering the
 * change bar, the chat and the drawer overlay.
 */
test("the topbar carries a stack position of its own", async () => {
  const css = withoutComments(await read());
  const rule = css.match(/(?:^|\n)\.topbar\s*\{([^}]*position:\s*relative[^}]*)\}/u);
  assert.ok(rule, ".topbar must be positioned for its z-index to apply");
  const z = rule[1].match(/z-index:\s*(\d+)/u);
  assert.ok(z, "the topbar needs a z-index, so the popover reads while rise-in is still running");
  const value = Number(z[1]);
  assert.ok(value >= 2, `z-index is ${value}; the ribbons' own children sit at 1`);
  assert.ok(value < 40, `z-index is ${value}; at 40 and up the topbar starts covering the change bar`);
});
