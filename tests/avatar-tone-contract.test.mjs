import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A tone declared in domain.ts but missing from styles.css renders with no
 * background at all, which looks like a meaningful difference between members.
 * That shipped: `sand` and `rose` were in the type and absent from the CSS, so
 * 3 of 9 members in the table showed bare initials. Types cannot catch it —
 * the class name is built by string concatenation — so check it here.
 */

async function tones() {
  const source = await readFile(path.join(root, "src", "domain.ts"), "utf8");
  const list = source.match(/export const AVATAR_TONES = \[([^\]]+)\] as const;/u);
  assert.ok(list, "AVATAR_TONES must stay a literal array so this test can read it");
  const parsed = [...list[1].matchAll(/"([a-z-]+)"/gu)].map((m) => m[1]);
  assert.ok(parsed.length >= 2, `expected several tones, parsed ${parsed.length}`);
  return parsed;
}

/** The `:root` blocks, in source order. The theme block overrides the base one. */
async function rootBlocks() {
  const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
  const blocks = [...css.matchAll(/(?:^|\})\s*:root\s*\{([^}]*)\}/gmu)].map((m) => m[1]);
  assert.ok(blocks.length >= 1, "expected at least one :root block");
  return { css, blocks };
}

test("every avatar tone has a background rule", async () => {
  const { css } = await rootBlocks();
  const missing = (await tones()).filter((tone) => !new RegExp(`\\.avatar\\.${tone}\\s*\\{`, "u").test(css));
  assert.deepEqual(missing, [], `tones with no .avatar.<tone> rule: ${missing.join(", ")}`);
});

test("a palette that defines any avatar tone defines all of them", async () => {
  // Not every :root block is a palette — one only adds --focus-ring and friends.
  // The bug was a palette covering 4 of 6 tones, so check for partial coverage
  // rather than demanding every block carry the whole set.
  const { blocks } = await rootBlocks();
  const list = await tones();
  const gaps = [];
  let palettes = 0;
  blocks.forEach((block, index) => {
    const defined = list.filter((tone) => new RegExp(`--${tone}\\s*:`, "u").test(block));
    if (defined.length === 0) return;
    palettes += 1;
    for (const tone of list) {
      if (!defined.includes(tone)) gaps.push(`:root[${index}] defines ${defined.length}/${list.length} tones, missing --${tone}`);
    }
  });
  assert.ok(palettes > 0, "no :root block defines any avatar tone");
  assert.deepEqual(gaps, [], gaps.join("; "));
});

test("no avatar tone resolves to a bare colour keyword or an undefined variable", async () => {
  const { css } = await rootBlocks();
  for (const tone of await tones()) {
    const rule = css.match(new RegExp(`\\.avatar\\.${tone}\\s*\\{([^}]*)\\}`, "u"));
    assert.ok(rule, `.avatar.${tone} rule not found`);
    const used = rule[1].match(/var\(--([a-z-]+)\)/u);
    assert.ok(used, `.avatar.${tone} should use a palette variable, got: ${rule[1].trim()}`);
    assert.equal(used[1], tone, `.avatar.${tone} should use var(--${tone}), got var(--${used[1]})`);
  }
});

/**
 * The picker avatar collapsed twice: first because `.proposal-picker-item span`
 * matched it and beat `.avatar { flex: 0 0 34px }`, then because `width: 28px`
 * alone still lost to the inherited flex-basis. Both need to stay fixed.
 */
test("the proposal picker sizes its avatar by flex basis, not width alone", async () => {
  const { css } = await rootBlocks();
  const rule = css.match(/\.proposal-picker-item \.avatar\s*\{([^}]*)\}/u);
  assert.ok(rule, ".proposal-picker-item .avatar rule not found");
  assert.match(rule[1], /flex:\s*0\s+0\s+28px/u, "needs an explicit flex basis, or the 34px basis wins");
  assert.match(rule[1], /height:\s*28px/u);
});

test("the proposal picker grows a named element, not every span", async () => {
  const { css } = await rootBlocks();
  assert.doesNotMatch(
    css,
    /\.proposal-picker-item\s+span\s*\{/u,
    "an unqualified descendant `span` selector also matches span.avatar",
  );
  assert.match(css, /\.proposal-picker-copy\s*\{[^}]*flex:\s*1/u);

  const tsx = await readFile(path.join(root, "src", "expanded-views.tsx"), "utf8");
  const uses = tsx.match(/proposal-picker-copy/gu) ?? [];
  assert.equal(uses.length, 2, `expected both picker rows to use the class, found ${uses.length}`);
});
