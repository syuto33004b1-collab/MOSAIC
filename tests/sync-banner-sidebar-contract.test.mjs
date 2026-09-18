import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const app = await readFile(path.join(root, "src", "App.tsx"), "utf8");

/**
 * #406: the quiet SHARED sync banner lives in the sidebar and must collapse
 * with `.month-card`, not behind a second copy of `max-width: 1080px`.
 */
test("compact sidebar hides the quiet sync banner with the week card (#406)", () => {
  assert.match(
    css,
    /\.month-card,\s*\.sync-banner-sidebar,\s*\.profile-row > span:nth-child\(2\) \{ display: none; \}/u,
    "`.sync-banner-sidebar` must ride the existing compact-sidebar hide list with `.month-card`",
  );
  const compactQueries = [...css.matchAll(/@media \(max-width: 1080px\)/gu)];
  assert.equal(compactQueries.length, 1, "do not add another 1080px query just for the sync banner");
});

test("the sidebar sync banner does not keep the workspace negative margin (#406)", () => {
  const rule = /\.sync-banner-sidebar\s*\{([^}]*)\}/u.exec(css);
  assert.ok(rule, "`.sync-banner-sidebar` lost its rule");
  assert.match(rule[1], /margin:\s*0 2px 12px/u);
  assert.match(rule[1], /box-shadow:\s*none/u);
  assert.ok(!/margin:\s*-8px/u.test(rule[1]), "negative top margin would bite `.month-card`");
});

test("shared sync markup is one banner switched by status (#406)", () => {
  assert.match(app, /const syncBanner = mode === "shared"/u);
  assert.match(app, /\{!syncNeedsAction && syncBanner\}/u);
  assert.match(app, /\{syncNeedsAction && syncBanner\}/u);
  const mounts = app.match(/className=\{\["sync-banner"/g) ?? [];
  assert.equal(mounts.length, 1, "do not dual-mount the banner and hide one with CSS");
});
