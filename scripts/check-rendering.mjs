/**
 * Accessibility checks against the built site, in a real browser.
 *
 * Why not jsdom, where the four existing `axe.run` calls live: jsdom computes no colour, so
 * every one of them disables `color-contrast`. That left the repository with no way to
 * measure contrast at all, which #305 is about. A real browser computes it.
 *
 * What it covers is one pass over the nine navigation screens and four panel states,
 * in one browser. #305 weighed that against the run time AGENTS.md warns about: a browser
 * per screen would pay the launch cost nine times.
 *
 * Every impact fails, not only serious and critical. Measured before writing this: there
 * are no violations on any of the thirteen states, so the strictest setting costs nothing
 * today and says so if that changes.
 *
 * `incomplete` is reported and does not fail. axe returns 54 nodes there, all of them
 * 「background color could not be determined due to a pseudo element」 — it cannot decide,
 * and failing on what it cannot decide would fail on every decorative `::before`.
 *
 * Usage: `npm run test:render`. Needs a Chrome; set CHROME_PATH if it is not in a usual
 * place. `--keep-open` leaves the browser up for a look.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const axeSource = path.join(root, "node_modules", "axe-core", "axe.min.js");
const BASE = "/MOSAIC/";

/** The nine entries in the sidebar, by the prefix each button's label starts with. */
const SCREENS = [
  "アサインボード", "プロジェクト", "受注前", "メンバー", "提案",
  "組織", "スキルマップ", "項目定義", "レポート",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function chromePath() {
  const configured = process.env.CHROME_PATH || process.env.CHROME_BIN;
  if (configured) return configured;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  throw new Error(`no Chrome found. Set CHROME_PATH. Looked in:\n  ${candidates.join("\n  ")}`);
}

/**
 * The built site, served the way Pages serves it — under `/MOSAIC/`, with unknown paths
 * falling back to the entry point, because `vite.config.ts` sets that base.
 */
async function serveDist() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname.slice(1);
    const file = path.join(dist, relative || "index.html");
    try {
      const body = await readFile(file.endsWith(path.sep) ? path.join(file, "index.html") : file);
      response.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      const fallback = await readFile(path.join(dist, "index.html"));
      response.writeHead(200, { "content-type": MIME[".html"] });
      response.end(fallback);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs axe over the whole document and returns what it found, flattened for printing. */
async function scan(page, state) {
  const result = await page.evaluate(async () => {
    const outcome = await window.axe.run(document.body);
    const flatten = (rules) => rules.flatMap((rule) => rule.nodes.map((node) => ({
      id: rule.id,
      impact: node.impact ?? rule.impact ?? "none",
      target: String(node.target[0] ?? "").slice(0, 90),
      message: (node.any?.[0]?.message ?? node.all?.[0]?.message ?? "").slice(0, 120),
    })));
    return { violations: flatten(outcome.violations), incomplete: flatten(outcome.incomplete) };
  });
  return { state, ...result };
}

async function main() {
  if (!existsSync(dist)) throw new Error(`no ${path.relative(root, dist)}. Run \`npm run build\` first.`);
  const { server, origin } = await serveDist();
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: !process.argv.includes("--keep-open"),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const results = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    // The app sends `script-src 'self'`, so axe cannot be added any other way.
    await page.setBypassCSP(true);
    await page.goto(`${origin}${BASE}`, { waitUntil: "networkidle0" });
    await page.evaluate(await readFile(axeSource, "utf8"));

    /**
     * By accessible name, not by text. The notification bell and the assistant launcher
     * are icons with an `aria-label` and nothing inside — matching on `textContent` alone
     * silently found nothing, and a click that never happens looks exactly like a state
     * with no violations.
     */
    const click = (label) => page.evaluate((labels) => {
      const wanted = Array.isArray(labels) ? labels : [labels];
      const button = [...document.querySelectorAll("button")]
        .find((item) => wanted.includes(item.getAttribute("aria-label")) || wanted.includes(item.textContent.trim()));
      if (!button) throw new Error(`no button labelled ${wanted.join(" or ")}`);
      button.click();
    }, label);

    /** Proof that the state actually opened, so a silent no-op cannot pass as clean. */
    const expectPresent = async (selector, state) => {
      const present = await page.evaluate((css) => Boolean(document.querySelector(css)), selector);
      if (!present) throw new Error(`${state} did not open: ${selector} is absent`);
    };

    for (const screen of SCREENS) {
      await page.evaluate((label) => {
        const nav = document.querySelector('nav[aria-label="メインナビゲーション"]');
        const button = [...nav.querySelectorAll("button")].find((item) => item.textContent.trim().startsWith(label));
        if (!button) throw new Error(`no navigation entry for ${label}`);
        button.click();
      }, screen);
      await wait(400);
      results.push(await scan(page, screen));
    }

    // Back to the board, then the states that live on top of it. #305 lists these as
    // never having been checked — including a form after a refused submit.
    await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="メインナビゲーション"]');
      [...nav.querySelectorAll("button")].find((item) => item.textContent.trim().startsWith("アサインボード")).click();
    });
    await wait(400);

    await click("通知");
    await wait(300);
    await expectPresent(".notification-popover, [class*=popover]", "通知パネル");
    results.push(await scan(page, "通知パネル"));
    await page.keyboard.press("Escape");
    await wait(200);

    await click("アサインを追加");
    await wait(400);
    await expectPresent("[role=dialog]", "アサイン追加ドロワー");
    results.push(await scan(page, "アサイン追加ドロワー"));
    await page.evaluate(() => {
      const dialog = document.querySelector("[role=dialog]");
      const submit = [...dialog.querySelectorAll("button")].find((item) => item.textContent.includes("仮置き"));
      if (!submit) throw new Error("the assignment drawer has no submit");
      submit.click();
    });
    await wait(300);
    results.push(await scan(page, "アサイン追加ドロワー（送信後）"));
    await page.keyboard.press("Escape");
    await wait(200);

    // Two labels, because the launcher says something different when the assistant is not
    // available — which is the demo build's state, since it has no server to call.
    await click(["AIアシスタントを開く", "AIアシスタントの利用状況を確認"]);
    await wait(600);
    await expectPresent(".ai-chat-root section, .ai-chat-panel", "AI秘書パネル");
    results.push(await scan(page, "AI秘書パネル"));
  } finally {
    if (!process.argv.includes("--keep-open")) await browser.close();
    server.close();
  }

  const violations = results.flatMap((result) => result.violations.map((item) => ({ ...item, state: result.state })));
  const incomplete = results.flatMap((result) => result.incomplete.map((item) => ({ ...item, state: result.state })));

  console.log(`axe over ${results.length} states at 1440x900`);
  for (const result of results) {
    console.log(`  ${result.violations.length === 0 ? "ok" : "FAIL"}  ${result.state}`
      + `  violations=${result.violations.length} incomplete=${result.incomplete.length}`);
  }
  if (incomplete.length > 0) {
    const reasons = new Map();
    for (const item of incomplete) reasons.set(item.message, (reasons.get(item.message) ?? 0) + 1);
    console.log(`\nincomplete (${incomplete.length}) — axe could not decide these, so they do not fail:`);
    for (const [message, count] of reasons) console.log(`  ${count}x ${message}`);
  }
  if (violations.length > 0) {
    console.error(`\n${violations.length} axe violations:`);
    for (const item of violations) console.error(`  ${item.state}  ${item.impact}  ${item.id}  ${item.target}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nno axe violations at any impact");
}

await main();
