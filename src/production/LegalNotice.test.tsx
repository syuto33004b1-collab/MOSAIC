import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { LegalNotice } from "./LegalNotice";

describe("LegalNotice", () => {
  it("separates the outbound facts from the draft legal sections", () => {
    render(<LegalNotice />);

    expect(screen.getByRole("heading", { level: 1, name: "プライバシーと利用規約" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "社外へ出る経路" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: /モデル提供者/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Remote MCP" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Google ログイン" })).toBeInTheDocument();
    expect(screen.getByText(/業務データは Google へ送りません/)).toBeInTheDocument();
    expect(screen.queryByText(/gemini/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("note")).toHaveLength(2);
    expect(screen.getAllByText(/差し替え箇所/).length).toBe(2);
    expect(screen.getByRole("link", { name: "MOSAIC に戻る" })).toHaveAttribute("href", expect.stringMatching(/^(?!.*legal=1)/));
  });

  it("has no serious automatic accessibility violations", async () => {
    const { container } = render(<LegalNotice />);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  });
});
