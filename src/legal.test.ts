import { describe, expect, it } from "vitest";
import { isLegalSearch, withLegalSearch, withoutLegalSearch } from "./legal";

describe("legal notice query", () => {
  it("accepts only the single spelling legal=1", () => {
    expect(isLegalSearch("?legal=1")).toBe(true);
    expect(isLegalSearch("legal=1")).toBe(true);
    expect(isLegalSearch("?legal=privacy")).toBe(false);
    expect(isLegalSearch("?legal=true")).toBe(false);
    expect(isLegalSearch("?legal=")).toBe(false);
    expect(isLegalSearch("")).toBe(false);
  });

  it("adds legal without dropping invitation or share keys", () => {
    expect(withLegalSearch({ pathname: "/", search: "?invitation=abc&nav=members", hash: "" }))
      .toBe("/?invitation=abc&nav=members&legal=1");
  });

  it("removes only legal when closing", () => {
    expect(withoutLegalSearch({ pathname: "/", search: "?invitation=abc&legal=1&nav=members", hash: "#legal-outbound" }))
      .toBe("/?invitation=abc&nav=members");
    expect(withoutLegalSearch({ pathname: "/", search: "?legal=1", hash: "#legal-privacy" })).toBe("/");
    expect(withoutLegalSearch({ pathname: "/", search: "?legal=1", hash: "#top" })).toBe("/#top");
    expect(withoutLegalSearch({ pathname: "/", search: "?legal=1", hash: "" })).toBe("/");
  });
});
