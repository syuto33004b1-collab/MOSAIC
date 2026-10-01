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
  // Vertical position stays on `.overlay` (`align-items: center`, #407).
  // `align-self: flex-start` pinned a short project to the top (#469).
  assert.doesNotMatch(shell[1], /align-self/);
  // The twelve months are one line now (#583); nothing may lay them out in two columns.
  assert.equal(/\.profile-capacity/u.test(css), false, "the bar rail's rules are gone");
  assert.match(css, /\.project-detail \.drawer-section-title \{[^}]*margin-bottom:\s*12px/);
  assert.match(css, /\.project-detail \.detail-facts \{[^}]*padding:\s*16px[^}]*gap:\s*16px/);
  assert.match(css, /\.project-detail \.detail-member-list button \{[^}]*padding:\s*12px 14px/);
  assert.match(css, /\.project-detail \.detail-member-list small,\s*\.project-detail \.detail-need-list small \{[^}]*word-break:\s*keep-all[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.project-need-allocation \{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.project-detail \.detail-need-list \{[^}]*gap:\s*10px/);
  assert.match(css, /\.project-detail \.detail-need-list button \{[^}]*padding:\s*12px 14px/);
  // A per-person comb has no place on a line; the figure under each point carries the count.
  assert.equal(/capacityTickMarks|project-capacity-tick/u.test(app), false);
  assert.equal(/project-capacity-tick/u.test(css), false);
  assert.match(app, /className="project-need-allocation"/);
  assert.match(app, /稼働配分 \$\{need\.allocation\}%/);
  assert.match(media, /\.drawer\.project-detail-open \.detail-member-list,\s*\.drawer\.project-detail-open \.detail-need-list \{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
  assert.equal(app.includes('className="project-detail"'), true);
  assert.equal(app.includes("project-detail-open"), true);
  assert.match(app, /\$\{count\}\/\$\{selectedProject\.demand\}名/);
  assert.match(app, /稼働配分 \$\{assignment\.allocation\}%/);
  assert.match(app, /稼働配分 \$\{need\.allocation\}%/);
  // The line is short, so it sits under its heading, outside the region that scrolls the
  // assignee list; the region holds the list alone and is named for it (#583).
  const from = app.indexOf('className="project-detail-assignees"');
  const scroll = app.slice(from, app.indexOf('className="project-detail-facts"', from));
  assert.match(scroll, /の担当/);
  assert.equal(scroll.includes("project-capacity-trend"), false);
  assert.equal(scroll.includes("の充足"), false);
  const beforeScroll = app.slice(app.indexOf('className="project-detail-period"'), from);
  assert.match(beforeScroll, /の充足/);
  assert.match(beforeScroll, /<LabelledTrend\s+className="project-capacity-trend"/);
  const projectFrom = app.indexOf('className="project-detail"');
  const projectBlock = app.slice(projectFrom, app.indexOf('drawer === "member"', projectFrom));
  assert.equal(projectBlock.includes("member-detail"), false);
  const projectCssStart = css.indexOf("/* Project detail (#439)");
  const projectCss = css.slice(projectCssStart, css.indexOf(".profile-skills", projectCssStart));
  assert.ok(projectCss.length > 0, "expected the project detail rules before .profile-skills");
  assert.equal(projectCss.includes("member-detail"), false);
  assert.match(app, /projectPeriodHeadline/);
  assert.match(app, /className="project-detail-more"/);
  assert.match(app, /要員要件\\u3000なし/);
  assert.equal(projectBlock.includes('.replace(/^\\d{4}年/'), false);
  assert.equal(projectBlock.includes("entity-action-row"), false);
  const moreAt = projectBlock.indexOf('className="project-detail-more"');
  const editAt = projectBlock.indexOf("案件情報を編集");
  assert.ok(moreAt >= 0 && editAt > moreAt, "編集は「その他」の中");
  const actionFlex = [...css.matchAll(/\.project-detail-actions > \.drawer-primary,\s*\.project-detail-actions > \.drawer-secondary \{([^}]+)\}/gu)];
  assert.equal(actionFlex.length, 2);
  for (const rule of actionFlex) {
    assert.match(rule[1], /flex:\s*1 1 0/);
    assert.match(rule[1], /min-width:\s*9rem/);
    assert.doesNotMatch(rule[1], /50%/);
  }
});
