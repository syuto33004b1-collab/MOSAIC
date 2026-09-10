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
 * are no violations on any of the states, so the strictest setting costs nothing today and
 * says so if that changes.
 *
 * ## What it does not decide
 *
 * `color-contrast` comes back partly as `incomplete` — axe ran the rule and could not
 * reach an answer, mostly because a decorative pseudo-element sits behind the text. On the
 * board that is 64 nodes decided against 54 undecided. **A low-contrast element hiding
 * among the undecided ones would pass this check.** So the counts are printed, and a
 * *reason* that has not been seen before fails: a new kind of undecidable is worth
 * knowing about, while one more node of a known kind is content moving. #312 carries the
 * gap itself.
 *
 * ## Why every step proves itself
 *
 * The first version matched buttons by `textContent`. The notification bell and the
 * assistant launcher are icons with an `aria-label` and nothing inside, so it found
 * nothing, clicked nothing, and scanned the board again under the panel's name — and a
 * state that never opened has no violations either. Every step now waits for something
 * only the intended state produces.
 *
 * Usage: `npm run test:render`. Needs a Chrome; set CHROME_PATH if it is not in a usual
 * place. `--keep-open` leaves the browser up for a look.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const axeSource = path.join(root, "node_modules", "axe-core", "axe.min.js");
const BASE = "/MOSAIC/";
const KEEP_OPEN = process.argv.includes("--keep-open");

/** The nine sidebar entries, and the `<h1>` each screen puts up (from `pageMeta`). */
const SCREENS = [
  ["アサインボード", "チーム編成"],
  ["プロジェクト", "プロジェクト・ポートフォリオ"],
  ["受注前", "受注前案件"],
  ["メンバー", "メンバーと空き状況"],
  ["提案", "候補者提案"],
  ["組織", "組織階層"],
  ["スキルマップ", "スキルマップ"],
  ["項目定義", "項目と経歴"],
  ["レポート", "キャパシティ予測"],
];

/**
 * The reasons axe has been seen to give up on a contrast decision. A new one means a new
 * kind of undecidable, which is the part worth a person's attention.
 */
const KNOWN_INCOMPLETE = [
  "Element's background color could not be determined due to a pseudo element",
  "Element's background color could not be determined because it is overlapped by another element",
  "Element's background color could not be determined because it partially overlaps other elements",
  "Element's background color could not be determined because it's partially obscured by another element",
  "Element content is too short to determine if it is actual text content",
  "",
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
 * The built site under `/MOSAIC/`, the way Pages serves it.
 *
 * A missing file is a 404, not a fallback to the entry point: the screens are reached by
 * clicking, never by URL, so nothing here needs one — and a fallback would answer a
 * missing stylesheet with HTML and let the sweep measure contrast on an unstyled page.
 */
async function serveDist() {
  const missing = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname.slice(1);
    const file = path.join(dist, relative || "index.html");
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      missing.push(url.pathname);
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}`, missing };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check` in the page until it is true, so no step depends on a fixed delay. */
async function until(page, description, check, argument) {
  const deadline = Date.now() + 8000;
  for (;;) {
    if (await page.evaluate(check, argument)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await wait(100);
  }
}

/**
 * The whole document, not `document.body`: `<html lang>` and the title are rules too.
 *
 * Every animation is waited out first. Without it the drawer's candidate list was still
 * fading in, and axe decided a different number of nodes each run — 40, then 11, then 22.
 * A check that varies is not a check. `getAnimations()` covers CSS animations and
 * transitions; a rejected promise means the animation was cancelled, which is settled too.
 */
async function scan(page, state) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  const result = await page.evaluate(async () => {
    const outcome = await window.axe.run();
    const flatten = (rules) => rules.flatMap((rule) => rule.nodes.map((node) => ({
      id: rule.id,
      impact: node.impact ?? rule.impact ?? "none",
      target: String(node.target[0] ?? "").slice(0, 90),
      message: (node.any?.[0]?.message ?? node.all?.[0]?.message ?? "").slice(0, 160),
    })));
    return { violations: flatten(outcome.violations), incomplete: flatten(outcome.incomplete) };
  });
  return { state, ...result };
}

async function main() {
  if (!existsSync(dist)) throw new Error(`no ${path.relative(root, dist)}. Run \`npm run build\` first.`);
  const executablePath = chromePath();
  // Not on Windows: `chrome.exe --version` there does not print a version, it hands the
  // argument to a running session and opens a window. The path is the diagnostic that
  // matters anyway — which Chrome a failing runner picked up.
  let version = "";
  if (process.platform !== "win32") {
    try {
      version = ` (${execFileSync(executablePath, ["--version"], { encoding: "utf8" }).trim()})`;
    } catch {
      version = " (version unavailable)";
    }
  }
  console.log(`chrome: ${executablePath}${version}`);

  const { server, origin, missing } = await serveDist();
  const browser = await puppeteer.launch({
    executablePath,
    headless: !KEEP_OPEN,
    // Only where the runner needs it. A local run has a normal user namespace.
    args: process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
  });
  const results = [];
  const consoleErrors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 200)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200));
    });
    await page.setViewport({ width: 1440, height: 900 });
    // The app sends `script-src 'self'`, so axe cannot be added any other way.
    await page.setBypassCSP(true);
    await page.goto(`${origin}${BASE}`, { waitUntil: "networkidle0" });
    await page.evaluate(await readFile(axeSource, "utf8"));

    /** By accessible name or text, and never silently: an icon button has only the former. */
    const click = (label) => page.evaluate((labels) => {
      const wanted = Array.isArray(labels) ? labels : [labels];
      const button = [...document.querySelectorAll("button")]
        .find((item) => wanted.includes(item.getAttribute("aria-label")) || wanted.includes(item.textContent.trim()));
      if (!button) throw new Error(`no button labelled ${wanted.join(" or ")}`);
      button.click();
    }, label);

    /**
     * Visible, not merely present. `querySelector` matches a hidden element, and the
     * drawers animate in — a check on existence alone would scan a panel at `opacity: 0`.
     * The three options are all needed: without them `checkVisibility` passes
     * `visibility: hidden` and `opacity: 0` through.
     */
    const seeing = (page_, selector) => until(page_, `${selector} to be visible`, (css) => {
      const element = document.querySelector(css);
      if (!element?.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= 1 && rect.height >= 1;
    }, selector);

    for (const [entry, heading] of SCREENS) {
      await page.evaluate((label) => {
        const nav = document.querySelector('nav[aria-label="メインナビゲーション"]');
        const button = [...nav.querySelectorAll("button")].find((item) => item.textContent.trim().startsWith(label));
        if (!button) throw new Error(`no navigation entry for ${label}`);
        button.click();
      }, entry);
      // The screen's own heading, not a delay: a slow render would otherwise be recorded
      // under the next screen's name.
      await until(page, `the ${entry} screen`, (want) => document.querySelector("h1")?.textContent?.trim() === want, heading);
      results.push(await scan(page, entry));
    }

    await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="メインナビゲーション"]');
      [...nav.querySelectorAll("button")].find((item) => item.textContent.trim().startsWith("アサインボード")).click();
    });
    await until(page, "the board", () => document.querySelector("h1")?.textContent?.trim() === "チーム編成");

    // The states that sit on top of the board. #305 lists these as never checked.
    await click("通知");
    await until(page, "the notification popover", () => Boolean(
      document.querySelector('button[aria-label="通知"]')?.getAttribute("aria-expanded") === "true"
      && document.querySelector('button[aria-label="通知を閉じる"]')));
    await seeing(page, 'button[aria-label="通知を閉じる"]');
    results.push(await scan(page, "通知パネル"));
    await page.keyboard.press("Escape");
    await until(page, "the popover to close", () => !document.querySelector('button[aria-label="通知を閉じる"]'));

    await click("アサインを追加");
    await seeing(page, "[role=dialog]");
    results.push(await scan(page, "アサイン追加ドロワー"));

    // A refused submit, which is the state #305 asks for and the first version never
    // reached: with valid defaults the form saves and the drawer closes, so the board got
    // scanned under this name.
    //
    // The refusal has to be one the handler makes, not one the browser makes. The end date
    // carries `min={form.startDate}`, so a date before the start never reaches the code —
    // the same shape as #258, where a submit the browser refused left a stale error up. A
    // date past the project's end passes the input and is refused by `handleAddAssignment`.
    await page.evaluate(() => {
      const dialog = document.querySelector("[role=dialog]");
      const end = [...dialog.querySelectorAll("input[type=date]")]
        .find((item) => (item.labels?.[0]?.textContent ?? "").trim().startsWith("終了日"));
      if (!end) throw new Error("the assignment drawer has no end date");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(end, "2030-12-31");
      end.dispatchEvent(new Event("input", { bubbles: true }));
      end.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.evaluate(() => {
      const dialog = document.querySelector("[role=dialog]");
      const submit = [...dialog.querySelectorAll("button")].find((item) => item.textContent.includes("仮置き"));
      if (!submit) throw new Error("the assignment drawer has no submit");
      submit.click();
    });
    await until(page, "the refusal", () => document.querySelector(".toast.show")?.textContent?.includes("プロジェクト期間内") === true
      && Boolean(document.querySelector("[role=dialog]")));
    results.push(await scan(page, "アサイン追加ドロワー（送信を拒否された状態）"));
    await page.keyboard.press("Escape");
    await until(page, "the drawer to close", () => !document.querySelector("[role=dialog]"));

    // Two labels: the launcher says something else when the assistant has no server to
    // call, which is the demo build's state.
    await click(["AIアシスタントを開く", "AIアシスタントの利用状況を確認"]);
    await until(page, "the assistant panel", () => Boolean(
      document.querySelector(".ai-chat-launcher")?.getAttribute("aria-expanded") === "true"
      && document.querySelector(".ai-chat-root section")));
    await seeing(page, ".ai-chat-root section");
    results.push(await scan(page, "AI秘書パネル"));
  } finally {
    if (!KEEP_OPEN) await browser.close();
    server.close();
  }

  const violations = results.flatMap((result) => result.violations.map((item) => ({ ...item, state: result.state })));
  const incomplete = results.flatMap((result) => result.incomplete.map((item) => ({ ...item, state: result.state })));

  console.log(`\naxe over ${results.length} states at 1440x900`);
  for (const result of results) {
    console.log(`  ${result.violations.length === 0 ? "ok" : "FAIL"}  ${result.state}`
      + `  violations=${result.violations.length} incomplete=${result.incomplete.length}`);
  }

  const reasons = new Map();
  for (const item of incomplete) reasons.set(item.message, (reasons.get(item.message) ?? 0) + 1);
  if (reasons.size > 0) {
    console.log(`\nincomplete (${incomplete.length}) — axe ran the rule and could not decide.`
      + " Counted, not failed; a reason it has not given before is (#312):");
    for (const [message, count] of reasons) console.log(`  ${count}x ${message || "(no message)"}`);
  }

  const failures = [];
  const unknown = [...reasons.keys()].filter((message) => !KNOWN_INCOMPLETE.includes(message));
  if (unknown.length > 0) {
    failures.push(`axe could not decide for a reason it has not given before:\n  ${unknown.join("\n  ")}`);
  }
  if (missing.length > 0) failures.push(`the built site asked for files that are not there: ${[...new Set(missing)].join(", ")}`);
  if (consoleErrors.length > 0) failures.push(`the console carried errors:\n  ${[...new Set(consoleErrors)].join("\n  ")}`);
  if (violations.length > 0) {
    failures.push(`${violations.length} axe violations:\n`
      + violations.map((item) => `  ${item.state}  ${item.impact}  ${item.id}  ${item.target}`).join("\n"));
  }

  if (failures.length > 0) {
    console.error(`\n${failures.join("\n\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nno axe violations at any impact, no missing files, no console errors");
}

await main();
