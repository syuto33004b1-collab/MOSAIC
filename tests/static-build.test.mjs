import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

test("builds a GitHub Pages entry point under the MOSAIC base path", async () => {
  const html = await readFile(path.join(dist, "index.html"), "utf8");
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /\/MOSAIC\/assets\//);
  assert.match(html, /https:\/\/syuto33004b1-collab\.github\.io\/MOSAIC\/og\.png/);
  assert.match(html, /\/MOSAIC\/favicon\.svg/);
  assert.doesNotMatch(html, /__MOSAIC_CONNECT_SRC__/);
  assert.doesNotMatch(html, /__MOSAIC_UPGRADE_INSECURE_REQUESTS__/);
  assert.match(html, /upgrade-insecure-requests/);
  assert.doesNotMatch(html, /https:\/\/\*\.supabase\.co/);
});

test("ships the interactive assignment workspace and social image", async () => {
  const assetNames = await readdir(path.join(dist, "assets"));
  const scripts = assetNames.filter((name) => name.endsWith(".js"));
  assert.ok(scripts.length > 0, "expected a JavaScript application bundle");

  const bundle = (await Promise.all(
    scripts.map((name) => readFile(path.join(dist, "assets", name), "utf8")),
  )).join("\n");

  assert.match(bundle, /mosaic-local-workspace-v3/);
  assert.match(bundle, /プロジェクト・ポートフォリオ/);
  assert.match(bundle, /キャパシティ予測/);
  assert.match(bundle, /チームへ保存/);
  assert.match(bundle, /get_my_context/);

  const og = await stat(path.join(dist, "og.png"));
  assert.ok(og.size > 1_000_000, "expected the full MOSAIC social image");
});
