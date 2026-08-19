import { describe, expect, it } from "vitest";
import {
  anonymousCandidateLabel,
  buildShareHref,
  isFavorited,
  normalizeFavorites,
  parseMemberIds,
  parseShareSearch,
  readDemoFavorites,
  serializeShareSearch,
  toggleFavorite,
  DEMO_FAVORITES_KEY,
  DEMO_SEEDED_FAVORITES,
  MAX_FAVORITES,
} from "./collaboration";

describe("anonymous labels", () => {
  it("uses A-Z then numeric labels", () => {
    expect(anonymousCandidateLabel(0)).toBe("候補A");
    expect(anonymousCandidateLabel(25)).toBe("候補Z");
    expect(anonymousCandidateLabel(26)).toBe("候補27");
  });
});

describe("favorites", () => {
  it("toggles a member without duplicating it", () => {
    const added = toggleFavorite([], "member", "saeki");
    expect(added).toEqual([{ kind: "member", targetId: "saeki" }]);
    expect(isFavorited(added, "member", "saeki")).toBe(true);
    expect(toggleFavorite(added, "member", "saeki")).toEqual([]);
  });

  it("drops malformed records and caps the list", () => {
    expect(normalizeFavorites([{ kind: "member", targetId: "saeki" }, { kind: "org", targetId: "x" }, { kind: "project" }])).toEqual([
      { kind: "member", targetId: "saeki" },
    ]);
    const overflow = Array.from({ length: MAX_FAVORITES + 5 }, (_, index) => ({ kind: "member" as const, targetId: `m${index}` }));
    expect(normalizeFavorites(overflow)).toHaveLength(MAX_FAVORITES);
    expect(toggleFavorite(overflow.slice(0, MAX_FAVORITES), "member", "extra")).toHaveLength(MAX_FAVORITES);
  });

  it("seeds demo favorites only when local storage is empty", () => {
    const empty = {
      getItem(key: string) {
        expect(key).toBe(DEMO_FAVORITES_KEY);
        return null;
      },
    };
    expect(readDemoFavorites(empty)).toEqual(DEMO_SEEDED_FAVORITES);
    expect(readDemoFavorites({ getItem: () => "[]" })).toEqual([]);
  });
});

describe("share links", () => {
  it("parses member detail, search, and anonymous proposal URLs", () => {
    expect(parseShareSearch("?nav=members&open=saeki")).toEqual({ nav: "members", open: "saeki" });
    expect(parseShareSearch("nav=members&q=React")).toEqual({ nav: "members", q: "React" });
    expect(parseShareSearch("?members=saeki,nakamura,saeki&anonymous=1")).toEqual({
      nav: "proposal",
      memberIds: ["saeki", "nakamura"],
      anonymous: true,
    });
  });

  it("ignores unknown nav and unsafe identifiers", () => {
    expect(parseShareSearch("?nav=admin")).toBeNull();
    expect(parseShareSearch("?nav=members&open=../secret")).toEqual({ nav: "members" });
    expect(parseMemberIds("saeki, bad id, atlas")).toEqual(["saeki", "atlas"]);
  });

  it("serializes the shortest share query", () => {
    expect(serializeShareSearch({ nav: "board" })).toBe("");
    expect(serializeShareSearch({ nav: "members", open: "saeki" })).toBe("?nav=members&open=saeki");
    expect(serializeShareSearch({ nav: "proposal", memberIds: ["saeki", "nakamura"], anonymous: true })).toBe(
      "?nav=proposal&members=saeki%2Cnakamura&anonymous=1",
    );
  });

  it("keeps unrelated query params when building an href", () => {
    expect(buildShareHref(
      { origin: "https://example.test", pathname: "/MOSAIC/", search: "?invitation=abc&nav=board" },
      { nav: "projects", open: "atlas" },
    )).toBe("https://example.test/MOSAIC/?invitation=abc&nav=projects&open=atlas");
  });
});
