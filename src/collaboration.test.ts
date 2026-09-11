import { describe, expect, it } from "vitest";
import {
  anonymousCandidateLabel,
  buildShareHref,
  isFavorited,
  normalizeFavorites,
  nextHistoryAction,
  parseMemberIds,
  parseShareSearch,
  readDemoFavorites,
  serializeShareSearch,
  shareLocationFor,
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
    // A proposal carries what it is for, not only who is in it (#140).
    expect(parseShareSearch("?nav=proposal&members=a,b&need=need-1"))
      .toEqual({ nav: "proposal", memberIds: ["a", "b"], needId: "need-1" });
    // Validated like `open`, and only on the screen that has a use for it.
    expect(parseShareSearch("?nav=proposal&need=" + encodeURIComponent("../../etc"))).toEqual({ nav: "proposal" });
    expect(parseShareSearch("?nav=members&need=need-1")).toEqual({ nav: "members" });
    expect(serializeShareSearch({ nav: "proposal", memberIds: ["a"], needId: "need-1" }))
      .toBe("?nav=proposal&members=a&need=need-1");
    // A round trip cannot produce a value the parser would have rejected.
    expect(serializeShareSearch({ nav: "proposal", memberIds: ["a"], needId: "no spaces allowed" }))
      .toBe("?nav=proposal&members=a");
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

/**
 * #309: nothing wrote the address bar, so Back left the app, a reload returned to whatever
 * the link had said, and a drawer kept its `open=` after it closed. These two decide what
 * gets written and whether it is somewhere to come back from.
 */
describe("the address the reader is standing in", () => {
  const at = (search: string, hash = "") => ({ pathname: "/MOSAIC/", search, hash });

  it("keeps the path, and everything the share link has no opinion about", () => {
    // The deployed site is under a path, and `serializeShareSearch` says "" for the board.
    expect(shareLocationFor(at("?nav=members"), { nav: "board" })).toBe("/MOSAIC/");
    // An invitation is the reader's, and so is a fragment; only the share keys are ours.
    expect(shareLocationFor(at("?invitation=abc&nav=members&open=saeki", "#top"), { nav: "projects", open: "atlas" }))
      .toBe("/MOSAIC/?invitation=abc&nav=projects&open=atlas#top");
    expect(shareLocationFor(at("?invitation=abc&nav=members"), { nav: "board" })).toBe("/MOSAIC/?invitation=abc");
  });

  it("drops the drawer and the search box from the address when they close", () => {
    expect(shareLocationFor(at("?nav=members&open=saeki"), { nav: "members" })).toBe("/MOSAIC/?nav=members");
    expect(shareLocationFor(at("?nav=members&q=%E4%BD%90"), { nav: "members" })).toBe("/MOSAIC/?nav=members");
  });

  it("comes back from a screen, and from nothing else", () => {
    // The screen is what Back should undo.
    expect(nextHistoryAction("/MOSAIC/", "/MOSAIC/?nav=members")).toBe("push");
    expect(nextHistoryAction("/MOSAIC/?nav=members", "/MOSAIC/")).toBe("push");
    expect(nextHistoryAction("/MOSAIC/?nav=members", "/MOSAIC/?nav=projects")).toBe("push");

    // Opening a row, typing, picking a candidate: the same screen showing something else.
    // Twenty rows read in a list would otherwise bury the screen the reader wants back.
    expect(nextHistoryAction("/MOSAIC/?nav=members", "/MOSAIC/?nav=members&open=saeki")).toBe("replace");
    expect(nextHistoryAction("/MOSAIC/?nav=members&open=saeki", "/MOSAIC/?nav=members")).toBe("replace");
    expect(nextHistoryAction("/MOSAIC/?nav=members&q=a", "/MOSAIC/?nav=members&q=ab")).toBe("replace");
    expect(nextHistoryAction("/MOSAIC/?nav=proposal", "/MOSAIC/?nav=proposal&members=saeki")).toBe("replace");

    // And equal is equal, which is what the first pass sees when a link is followed. A push
    // there would put a second copy of the landing in the history and make Back do nothing.
    expect(nextHistoryAction("/MOSAIC/?nav=members&open=saeki", "/MOSAIC/?nav=members&open=saeki")).toBe("noop");
    expect(nextHistoryAction("/MOSAIC/", "/MOSAIC/")).toBe("noop");
  });

  it("reads a screen the way the parser does, and not out of the fragment", () => {
    // A nav nobody recognises is the board — that is what `parseShareSearch` returns for it,
    // so the address that replaces it is the same screen and must not be pushed. Otherwise
    // following such a link pushes on the first pass and Back lands between the two.
    expect(parseShareSearch("?nav=typo")).toBeNull();
    expect(nextHistoryAction("/MOSAIC/?nav=typo", "/MOSAIC/")).toBe("replace");
    expect(nextHistoryAction("/MOSAIC/?nav=typo", "/MOSAIC/?nav=members")).toBe("push");

    // And a fragment is a fragment, whatever it has in it.
    expect(nextHistoryAction("/MOSAIC/#/help?nav=members", "/MOSAIC/?nav=members")).toBe("push");
    expect(nextHistoryAction("/MOSAIC/?nav=members#top", "/MOSAIC/?nav=members&open=saeki#top")).toBe("replace");
  });
});
