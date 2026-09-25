import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

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
  assert.match(media, /\.drawer\.project-detail-open \.profile-capacity \{[^}]*flex-direction:\s*column/);
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
});
