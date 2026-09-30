import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { measuredStyle, specimenClassText, UI_CATALOG, UI_CATALOG_GAPS, UiCatalogView, type CatalogSpecimen } from "./ui-catalog";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const stylesheet = readFileSync(path.join(srcDir, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");

/** Every component file under src/ except the catalog and the tests: what the screens actually write. */
function screenSources() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) && entry.name !== "ui-catalog.tsx") files.push(full);
    }
  };
  walk(srcDir);
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

const token = (name: string) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`, "u");
const specimens: CatalogSpecimen[] = UI_CATALOG.flatMap((section) => section.cards.flatMap((card) => [...card.specimens]));

describe("UI catalog (#574)", () => {
  it("names only classes a screen still wears and the stylesheet still dresses", () => {
    const sources = screenSources();
    const missing: string[] = [];
    for (const specimen of specimens) {
      expect(specimen.classes.length, specimen.label).toBeGreaterThan(0);
      for (const name of [...specimen.classes, ...(specimen.context ?? [])]) {
        if (!token(`\\.${name}`).test(stylesheet)) missing.push(`${specimen.label}: .${name} is not in styles.css`);
        if (!token(name).test(sources)) missing.push(`${specimen.label}: ${name} is not worn by any screen`);
      }
      for (const modifier of specimen.modifiers ?? []) {
        if (!token(`\\.${specimen.classes[0]}\\.${modifier}`).test(stylesheet)) missing.push(`${specimen.label}: .${specimen.classes[0]}.${modifier} is not in styles.css`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("probes through the classes it names, not whatever element comes first", () => {
    for (const specimen of specimens) {
      expect(specimen.classes.some((name) => token(`\\.${name}`).test(specimen.probe)), `${specimen.label}: ${specimen.probe} names none of ${specimen.classes.join(", ")}`).toBe(true);
      for (const modifier of specimen.modifiers ?? []) {
        expect(new RegExp(`\\.${modifier}(?![\\w-])`, "u").test(specimen.probe), `${specimen.label}: ${specimen.probe} does not probe .${modifier}`).toBe(true);
      }
    }
  });

  it("draws every specimen's probe, inside the ancestors its screen's selectors need", () => {
    render(<UiCatalogView />);
    const figures = [...document.querySelectorAll(".ui-catalog-specimen")];
    expect(figures).toHaveLength(specimens.length);
    specimens.forEach((specimen, index) => {
      const figure = figures[index];
      expect(figure.querySelector("figcaption strong")?.textContent).toBe(specimen.label);
      const stage = figure.querySelector(".ui-catalog-stage")!;
      const probe = stage.querySelector(specimen.probe);
      expect(probe, `${specimen.label}: nothing matches ${specimen.probe}`).not.toBeNull();
      expect(probe!.matches(specimen.classes.map((name) => `.${name}, .${name} *`).join(", ")), `${specimen.label}: the probe is outside ${specimen.classes.join(", ")}`).toBe(true);
      for (const name of specimen.classes) {
        expect(stage.querySelector(`.${name}`), `${specimen.label}: .${name} is named but not drawn`).not.toBeNull();
      }
      for (const name of specimen.context ?? []) {
        expect(probe!.closest(`.${name}`), `${specimen.label}: .${name} is not an ancestor of the probe`).not.toBeNull();
      }
      expect(figure.querySelector("code")?.textContent).toBe(specimenClassText(specimen));
    });
  });

  it("shows the class that tells two neighbours apart", () => {
    expect(specimenClassText({ classes: ["status-pill"], modifiers: ["risk"] })).toBe(".status-pill.risk");
    expect(specimenClassText({ classes: ["four-week-rail", "staffed-label"] })).toBe(".four-week-rail .staffed-label");
    render(<UiCatalogView />);
    const captions = [...document.querySelectorAll(".ui-catalog-specimen code")].map((code) => code.textContent);
    for (const text of [".status-pill.active", ".status-pill.risk", ".view-add-button.ghost", ".quick-assign.quiet", ".icon-button.has-dot", ".load.over", ".need-note.planned"]) {
      expect(captions).toContain(text);
    }
  });

  it("measures again when a specimen changes, not only when it mounts", async () => {
    render(<UiCatalogView />);
    const figure = [...document.querySelectorAll(".ui-catalog-specimen")].find((item) => item.querySelector("figcaption strong")?.textContent === "詳細な条件")!;
    const measure = figure.querySelector(".ui-catalog-measure")!;
    expect(measure.textContent).toMatch(/^実測: /u);
    expect(measure.textContent).not.toContain("#010203");
    (figure.querySelector(".board-filter-details-toggle") as HTMLElement).style.backgroundColor = "rgb(1, 2, 3)";
    await waitFor(() => expect(measure.textContent).toContain("背景 #010203"));
  });

  it("marks every chart as a sample, where it is seen and where it is heard (#125)", () => {
    render(<UiCatalogView />);
    const charts = screen.getByRole("region", { name: "グラフ" });
    const cards = [...charts.querySelectorAll(".ui-catalog-card")];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(within(card as HTMLElement).getByText("見本")).toBeVisible();
    for (const image of within(charts).getAllByRole("img")) expect(image.getAttribute("aria-label")).toMatch(/^見本/u);
    expect(UI_CATALOG.find((section) => section.id === "charts")?.cards.every((card) => card.sample)).toBe(true);
  });

  it("says what it does not show yet", () => {
    render(<UiCatalogView />);
    const gaps = within(screen.getByRole("region", { name: "まだ並べていない部品" })).getAllByRole("listitem").map((item) => item.textContent);
    expect(gaps).toEqual([...UI_CATALOG_GAPS]);
  });

  it("lets the tabs, the disclosure and the inputs be tried", async () => {
    const user = userEvent.setup();
    render(<UiCatalogView />);
    const axis = screen.getByRole("group", { name: "見本の表示軸" });
    await user.click(within(axis).getByRole("button", { name: "プロジェクト別" }));
    expect(within(axis).getByRole("button", { name: "プロジェクト別" })).toHaveAttribute("aria-pressed", "true");
    expect(within(axis).getByRole("button", { name: "メンバー別" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "計画コストの部門" }));
    expect(screen.getByRole("button", { name: "計画コストの部門" })).toHaveAttribute("aria-pressed", "true");

    const toggle = screen.getByRole("button", { name: /詳細な条件/u });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.type(screen.getByRole("textbox", { name: "見本の検索" }), "abc");
    expect(screen.getByRole("textbox", { name: "見本の検索" })).toHaveValue("abc");
  });

  it("reports the computed colours as hex, and a transparent background as such", () => {
    expect(measuredStyle({ fontSize: "12px", color: "rgb(52, 17, 3)", backgroundColor: "rgba(0, 0, 0, 0)", borderRadius: "3px" }))
      .toBe("実測: 文字 12px · 文字色 #341103 · 背景 透明 · 角丸 3px");
    expect(measuredStyle({ fontSize: "", color: "rgba(185, 71, 44, 0.5)", backgroundColor: "rgb(255, 255, 255)", borderRadius: "" }))
      .toBe("実測: 文字 — · 文字色 #b9472c（50%） · 背景 #ffffff · 角丸 —");
    expect(measuredStyle({ fontSize: "12px", color: "color(srgb 1 0 0)", backgroundColor: "", borderRadius: "0px" }))
      .toBe("実測: 文字 12px · 文字色 color(srgb 1 0 0) · 背景 — · 角丸 0px");
  });
});
