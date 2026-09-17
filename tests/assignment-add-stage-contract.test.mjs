import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #394: 「アサインを追加」だけ中央の台。共有ドロワーシェル（trap / ESC / backdrop）は
 * 触らず、修飾クラスと `@media (min-width: 621px)` で配置だけ変える。620px 以下の
 * ボトムシートと他ドロワーの右寄せを壊さないことが契約。
 */

async function readCss() {
  return readFile(path.join(root, "src/styles.css"), "utf8");
}

function withoutComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//gu, "");
}

function declaration(css, selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(css);
  if (!block) return null;
  const match = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, "u").exec(block[1]);
  return match ? match[1].trim() : null;
}

/** Strip every `@media (min-width: 621px) { … }` block (one level of braces). */
function withoutMinWidth621(css) {
  return css.replace(/@media\s*\(\s*min-width:\s*621px\s*\)\s*\{([^{}]|\{[^{}]*\})*\}/gu, "");
}

function mediaMinWidth621Bodies(css) {
  const bodies = [];
  const re = /@media\s*\(\s*min-width:\s*621px\s*\)\s*\{/gu;
  let match;
  while ((match = re.exec(css))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    bodies.push(css.slice(start, i - 1));
  }
  return bodies;
}

test("assignment-add stage is centered only above the bottom-sheet breakpoint (#394)", async () => {
  const css = withoutComments(await readCss());
  const bodies = mediaMinWidth621Bodies(css);
  const stage = bodies.find((body) => body.includes(".assignment-add-overlay"));
  assert.ok(stage, "stage rules must live inside @media (min-width: 621px)");

  assert.equal(declaration(stage, ".assignment-add-overlay", "justify-content"), "center");
  assert.equal(declaration(stage, ".assignment-add-overlay", "align-items"), "center");
  assert.equal(declaration(stage, ".assignment-add-panel", "height"), "auto");
  assert.equal(declaration(stage, ".assignment-add-panel", "max-height"), "100%");
  assert.equal(declaration(stage, ".assignment-add-panel", "animation-name"), "assignment-add-in");
  assert.match(declaration(stage, ".assignment-add-panel", "width") ?? "",
    /min\(\s*100%\s*,\s*clamp\(\s*410px\s*,\s*48vw\s*,\s*620px\s*\)\s*\)/u);

  assert.equal(declaration(css, ".overlay", "justify-content"), "flex-end",
    "other drawers stay right-aligned");

  const outside = withoutMinWidth621(css);
  assert.equal(declaration(outside, ".assignment-add-overlay", "justify-content"), null,
    "stage overlay rules must not sit outside the 621px media query");
  assert.equal(declaration(outside, ".assignment-add-panel", "height"), null,
    "stage panel rules must not sit outside the 621px media query");

  // Theme `.drawer { box-shadow: -18px … }` comes later; the last matching stage
  // rule inside min-width 621 must re-assert a symmetric shadow and radius.
  const lastStage = [...bodies].reverse().find((body) => /\.assignment-add-panel\s*\{[^}]*box-shadow/u.test(body));
  assert.ok(lastStage, "stage panel must re-declare box-shadow after the theme drawer block");
  assert.match(declaration(lastStage, ".assignment-add-panel", "box-shadow") ?? "", /^0\s+/u,
    "stage shadow must not keep the rail's left-biased offset");
  assert.equal(declaration(lastStage, ".assignment-add-panel", "border-radius"), "20px");
});

test("App wires the stage classes only for drawer === add (#394)", async () => {
  const source = await readFile(path.join(root, "src/App.tsx"), "utf8");
  assert.match(source, /"overlay"\s*\+\s*\(drawer\s*===\s*"add"\s*\?\s*" assignment-add-overlay"\s*:\s*""\)/u);
  assert.match(source, /"drawer"\s*\+\s*\(drawer\s*===\s*"add"\s*\?\s*" assignment-add-panel"\s*:\s*""\)/u);
  assert.equal((source.match(/assignment-add-overlay/gu) ?? []).length, 1);
  assert.equal((source.match(/assignment-add-panel/gu) ?? []).length, 1);
});
