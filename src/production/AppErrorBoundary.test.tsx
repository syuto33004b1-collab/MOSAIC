import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function BrokenView(): never {
  throw new Error("sensitive workspace payload");
}

describe("AppErrorBoundary", () => {
  it("shows a safe recovery screen without exposing the thrown message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<AppErrorBoundary><BrokenView /></AppErrorBoundary>);

    expect(screen.getByRole("alert")).toHaveTextContent("画面を表示できませんでした");
    expect(screen.getByRole("button", { name: "MOSAICを再読み込み" })).toBeInTheDocument();
    expect(screen.queryByText("sensitive workspace payload")).not.toBeInTheDocument();
  });
});
