import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

/** Index of the `}` that closes the `{` at `open`, skipping comments. */
function blockEnd(source, open) {
  let depth = 0;
  let i = open;
  while (i < source.length) {
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return -1;
      i = end + 2;
      continue;
    }
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

test("the project drawer panes scroll the assignee list and the facts, not the member classes", () => {
  const start = css.indexOf(".drawer.project-detail-open {");
  assert.ok(start > 0, "expected the project two-pane rules");
  const media = css.slice(css.lastIndexOf("@media (min-width: 1052px) and (min-height: 720px)", start));
  const period = media.match(/\.project-detail-period \{([^}]+)\}/);
  const list = media.match(/\.project-detail-assignees \{([^}]+)\}/);
  const facts = media.match(/\.project-detail-facts \{([^}]+)\}/);
  assert.ok(period && list && facts);
  assert.match(period[1], /overflow:\s*hidden/);
  assert.match(list[1], /overflow:\s*auto/);
  assert.match(facts[1], /overflow:\s*auto/);
  const shell = media.match(/\.drawer\.project-detail-open \{([^}]+)\}/);
  assert.ok(shell);
  assert.match(shell[1], /height:\s*auto/);
  assert.match(shell[1], /max-height:\s*100%/);
  assert.match(shell[1], /align-self:\s*flex-start/);
  // `media` runs to EOF, so a match there does not prove the rail rule sits
  // outside the query. A rule parked at the end of the query would still pass
  // that, and April would sit beside May again below 720px.
  const mediaAt = css.lastIndexOf("@media (min-width: 1052px) and (min-height: 720px)", start);
  const mediaEnd = blockEnd(css, css.indexOf("{", mediaAt));
  const columnRules = [...css.matchAll(/\.drawer\.project-detail-open \.profile-capacity \{([^}]+)\}/gu)];
  assert.equal(columnRules.length, 1);
  assert.ok(columnRules[0].index > mediaEnd, "the capacity rail is one column outside the 1052×720 query");
  assert.match(columnRules[0][1], /display:\s*flex/);
  assert.match(columnRules[0][1], /flex-direction:\s*column/);
  assert.match(css, /\.project-detail \.drawer-section-title \{[^}]*margin-bottom:\s*12px/);
  assert.match(css, /\.project-detail \.detail-facts \{[^}]*padding:\s*16px[^}]*gap:\s*16px/);
  assert.match(css, /\.project-detail \.detail-member-list button \{[^}]*padding:\s*12px 14px/);
  assert.match(css, /\.project-detail \.profile-capacity \{[^}]*gap:\s*12px/);
  // Source order does not decide this. `.project-detail .profile-capacity > div`
  // (0, 2, 1) beats the global `.profile-capacity > div` (0, 1, 1), so the
  // 72px track stays in effect wherever that rule sits. The figure track of
  // every row rule is checked in detail-panel-width-contract.
  assert.match(css, /\.project-detail \.profile-capacity > div \{[^}]*72px minmax\(0, 1fr\) 80px/);
  assert.match(css, /\.project-detail \.detail-member-list small,\s*\.project-detail \.detail-need-list small,\s*\.project-detail \.profile-capacity span \{[^}]*word-break:\s*keep-all[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.project-need-allocation \{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.project-detail \.detail-need-list \{[^}]*gap:\s*10px/);
  assert.match(css, /\.project-detail \.detail-need-list button \{[^}]*padding:\s*12px 14px/);
  const bar = css.match(/\.project-detail \.profile-capacity i \{([^}]+)\}/);
  assert.ok(bar);
  assert.match(bar[1], /position:\s*relative/);
  assert.match(bar[1], /height:\s*10px/);
  const tick = css.match(/\.project-capacity-tick \{([^}]+)\}/);
  assert.ok(tick);
  assert.match(tick[1], /position:\s*absolute/);
  assert.match(tick[1], /top:\s*0/);
  assert.match(tick[1], /bottom:\s*0/);
  assert.match(tick[1], /width:\s*1px/);
  assert.match(tick[1], /background:\s*color-mix\(in srgb, var\(--ink\) 55%, transparent\)/);
  assert.match(css, /\.project-capacity-tick\[data-inside="true"\] \{[^}]*background:\s*var\(--paper\)/);
  assert.match(app, /capacityTickMarks/);
  assert.match(app, /className="project-capacity-tick"/);
  assert.match(app, /className="project-need-allocation"/);
  assert.match(app, /稼働配分 \$\{need\.allocation\}%/);
  assert.match(media, /\.drawer\.project-detail-open \.detail-member-list,\s*\.drawer\.project-detail-open \.detail-need-list \{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
  assert.equal(app.includes('className="project-detail"'), true);
  assert.equal(app.includes("project-detail-open"), true);
  assert.match(app, /\$\{count\}\/\$\{selectedProject\.demand\}名/);
  assert.match(app, /稼働配分 \$\{assignment\.allocation\}%/);
  assert.match(app, /稼働配分 \$\{need\.allocation\}%/);
  const from = app.indexOf('className="project-detail-assignees"');
  const scroll = app.slice(from, app.indexOf('className="project-detail-facts"', from));
  assert.match(scroll, /profile-capacity/);
  assert.match(scroll, /の担当/);
  const beforeScroll = app.slice(app.indexOf('className="project-detail-period"'), from);
  assert.match(beforeScroll, /の充足/);
  assert.equal(beforeScroll.includes("profile-capacity"), false);
  const projectFrom = app.indexOf('className="project-detail"');
  const projectBlock = app.slice(projectFrom, app.indexOf('drawer === "member"', projectFrom));
  assert.equal(projectBlock.includes("member-detail"), false);
  const projectCssStart = css.indexOf("/* Project detail (#439)");
  const projectCss = css.slice(projectCssStart, css.indexOf(".profile-skills", projectCssStart));
  assert.ok(projectCss.length > 0, "expected the project detail rules before .profile-skills");
  assert.equal(projectCss.includes("member-detail"), false);
});
