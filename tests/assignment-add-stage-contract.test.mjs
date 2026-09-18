import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #407: 621px 以上は詳細ドロワーを中央へ。幅は `.dialog-sm` / `.dialog-md` /
 * `.dialog-lg`。設定パネルは右寄せのまま。620px 以下のボトムシートは触らない。
 * #394 の「add だけ中央、他は右寄せ」はここが置き換える。
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

test("detail overlays center above the bottom-sheet breakpoint; settings stay right (#407)", async () => {
  const css = withoutComments(await readCss());
  const bodies = mediaMinWidth621Bodies(css);
  const stage = bodies.find((body) => body.includes(".dialog-sm") && body.includes(".overlay"));
  assert.ok(stage, "size rules must live inside @media (min-width: 621px) with .overlay");

  assert.equal(declaration(stage, ".overlay", "justify-content"), "center");
  assert.equal(declaration(stage, ".overlay", "align-items"), "center");
  assert.equal(declaration(stage, ".production-operations-overlay", "justify-content"), "flex-end");
  assert.equal(declaration(stage, ".production-operations-overlay", "align-items"), "stretch");

  assert.equal(declaration(stage, ".dialog-sm", "height"), "auto");
  assert.equal(declaration(stage, ".dialog-sm", "max-height"), "100%");
  assert.equal(declaration(stage, ".dialog-sm", "animation-name"), "assignment-add-in");
  assert.match(declaration(stage, ".dialog-sm", "width") ?? "",
    /min\(\s*100%\s*,\s*clamp\(\s*410px\s*,\s*48vw\s*,\s*620px\s*\)\s*\)/u);

  assert.equal(declaration(stage, ".dialog-md", "height"), "auto");
  assert.equal(declaration(stage, ".dialog-md", "max-height"), "100%");
  assert.match(declaration(stage, ".dialog-md", "width") ?? "",
    /min\(\s*100%\s*,\s*clamp\(\s*410px\s*,\s*48vw\s*,\s*720px\s*\)\s*\)/u);

  assert.equal(declaration(stage, ".dialog-lg", "height"), null,
    "lg keeps .drawer height: 100%; auto would re-center when details expand");
  assert.match(declaration(stage, ".dialog-lg", "width") ?? "",
    /min\(\s*100%\s*,\s*clamp\(\s*410px\s*,\s*62vw\s*,\s*1000px\s*\)\s*\)/u);

  assert.equal(declaration(css, ".overlay", "justify-content"), "flex-end",
    "base overlay stays end-aligned so the 620px sheet is unchanged");

  const outside = withoutMinWidth621(css);
  assert.equal(declaration(outside, ".dialog-sm", "height"), null,
    "sm height:auto must not sit outside the 621px media query");
  assert.equal(declaration(outside, ".dialog-md", "height"), null,
    "md height:auto must not sit outside the 621px media query");
  assert.equal(declaration(outside, ".overlay", "align-items"), null,
    "centering align-items must not sit outside the 621px media query");

  const lastStage = [...bodies].reverse().find((body) =>
    /dialog-lg\s*\{[^}]*box-shadow/u.test(body.replace(/\s+/gu, " ")));
  assert.ok(lastStage, "size modifiers must re-declare box-shadow after the theme drawer block");
  const grouped = lastStage.replace(/\s+/gu, " ");
  assert.match(declaration(grouped, ".dialog-sm, .dialog-md, .dialog-lg", "box-shadow") ?? "", /^0\s+/u,
    "stage shadow must not keep the rail's left-biased offset");
  assert.equal(declaration(grouped, ".dialog-sm, .dialog-md, .dialog-lg", "border-radius"), "20px");
  assert.match(declaration(grouped, ".dialog-sm, .dialog-md, .dialog-lg", "border") ?? "", /1px\s+solid/u);

  assert.equal(css.includes(":has(.dialog-sm)") || css.includes(":has(.dialog-md)") || css.includes(":has(.dialog-lg)"), false,
    "size modifiers must not be selected via :has");
});

test("App wires one size modifier per Drawer member and attention md (#407)", async () => {
  const source = await readFile(path.join(root, "src/App.tsx"), "utf8");
  const typeMatch = /type Drawer = ([^;]+);/u.exec(source);
  assert.ok(typeMatch, "Drawer type");
  const members = [...typeMatch[1].matchAll(/"([^"]+)"/gu)].map((m) => m[1]);
  assert.ok(members.length >= 15, `expected the Drawer union, got ${members.join(",")}`);

  const mapBlock = /const DRAWER_DIALOG_SIZE = \{([\s\S]*?)\}\s+as const satisfies Record<Exclude<Drawer, null>/u.exec(source);
  assert.ok(mapBlock, "DRAWER_DIALOG_SIZE must satisfy Exclude<Drawer, null>");
  const mapped = [...mapBlock[1].matchAll(/^\s*(\w+):\s*"(dialog-sm|dialog-lg)"/gmu)]
    .map((m) => [m[1], m[2]]);
  const mappedNames = mapped.map(([name]) => name);
  assert.deepEqual([...mappedNames].sort(), [...members].sort(),
    "every Drawer member except null must have exactly one size");
  assert.equal(mapped.filter(([, size]) => size === "dialog-sm").map(([name]) => name).join(), "add");
  assert.ok(mapped.every(([name, size]) => name === "add" ? size === "dialog-sm" : size === "dialog-lg"));

  assert.match(source, /className=\{\s*"drawer "\s*\+\s*DRAWER_DIALOG_SIZE\[drawer\]\s*\}/u);
  assert.match(source, /className="attention-dialog dialog-md"/u);
  assert.equal((source.match(/assignment-add-overlay/gu) ?? []).length, 0);
  assert.equal((source.match(/assignment-add-panel/gu) ?? []).length, 0);
  assert.equal((source.match(/attention-overlay/gu) ?? []).length, 0);
});
