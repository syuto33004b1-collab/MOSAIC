export const DEMO_FAVORITES_KEY = "mosaic-favorites-v1";
export const MAX_PROPOSAL_MEMBERS = 12;
export const MAX_FAVORITES = 100;

export const SHARE_NAV_IDS = ["board", "projects", "opportunities", "members", "org", "skills", "fields", "reports", "proposal"] as const;
export type ShareNavId = typeof SHARE_NAV_IDS[number];
export type FavoriteKind = "member" | "project";

export type Favorite = {
  kind: FavoriteKind;
  targetId: string;
};

export type ShareLink = {
  nav: ShareNavId;
  open?: string;
  q?: string;
  memberIds?: string[];
  anonymous?: boolean;
  /**
   * What the proposal is for: a project's staffing need or an opportunity's
   * staffing plan (#140). Validated like `open`, and only ever used to look one up
   * in the workspace already in memory.
   */
  needId?: string;
};

const SHARE_PARAM_KEYS = ["nav", "open", "q", "members", "anonymous", "need"] as const;
const NAV_SET = new Set<string>(SHARE_NAV_IDS);
const KIND_SET = new Set<FavoriteKind>(["member", "project"]);
const TARGET_ID_PATTERN = /^[\w:-]{1,80}$/;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const DEMO_SEEDED_FAVORITES: Favorite[] = [
  { kind: "member", targetId: "saeki" },
  { kind: "project", targetId: "atlas" },
];

export function isShareNav(value: unknown): value is ShareNavId {
  return typeof value === "string" && NAV_SET.has(value);
}

export function isFavoriteKind(value: unknown): value is FavoriteKind {
  return value === "member" || value === "project";
}

export function anonymousCandidateLabel(index: number) {
  if (index < 0) return "候補";
  if (index < 26) return `候補${LETTERS[index]}`;
  return `候補${index + 1}`;
}

export function favoriteKey(favorite: Pick<Favorite, "kind" | "targetId">) {
  return `${favorite.kind}:${favorite.targetId}`;
}

export function normalizeFavorites(value: unknown): Favorite[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: Favorite[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { kind?: unknown; targetId?: unknown; target_id?: unknown };
    const kind = record.kind;
    const targetId = typeof record.targetId === "string" ? record.targetId : typeof record.target_id === "string" ? record.target_id : "";
    if (!isFavoriteKind(kind) || !TARGET_ID_PATTERN.test(targetId)) continue;
    const favorite = { kind, targetId };
    const key = favoriteKey(favorite);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(favorite);
    if (next.length >= MAX_FAVORITES) break;
  }
  return next;
}

export function isFavorited(favorites: Favorite[], kind: FavoriteKind, targetId: string) {
  return favorites.some((favorite) => favorite.kind === kind && favorite.targetId === targetId);
}

export function toggleFavorite(favorites: Favorite[], kind: FavoriteKind, targetId: string): Favorite[] {
  if (!KIND_SET.has(kind) || !TARGET_ID_PATTERN.test(targetId)) return favorites;
  if (isFavorited(favorites, kind, targetId)) {
    return favorites.filter((favorite) => !(favorite.kind === kind && favorite.targetId === targetId));
  }
  if (favorites.length >= MAX_FAVORITES) return favorites;
  return [...favorites, { kind, targetId }];
}

export function readDemoFavorites(storage?: Pick<Storage, "getItem">): Favorite[] {
  try {
    const raw = (storage ?? window.localStorage).getItem(DEMO_FAVORITES_KEY);
    if (raw == null) return DEMO_SEEDED_FAVORITES.map((item) => ({ ...item }));
    return normalizeFavorites(JSON.parse(raw) as unknown);
  } catch {
    return DEMO_SEEDED_FAVORITES.map((item) => ({ ...item }));
  }
}

export function writeDemoFavorites(favorites: Favorite[], storage?: Pick<Storage, "setItem">) {
  (storage ?? window.localStorage).setItem(DEMO_FAVORITES_KEY, JSON.stringify(normalizeFavorites(favorites)));
}

export function parseMemberIds(value: string | null | undefined, limit = MAX_PROPOSAL_MEMBERS) {
  if (!value) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (!TARGET_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

function parseOpenId(value: string | null) {
  const id = value?.trim() ?? "";
  return TARGET_ID_PATTERN.test(id) ? id : undefined;
}

export function parseShareSearch(search: string): ShareLink | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const memberIds = parseMemberIds(params.get("members"));
  const navParam = params.get("nav");
  const open = parseOpenId(params.get("open"));
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const anonymous = params.get("anonymous") === "1";
  let nav: ShareNavId | undefined = isShareNav(navParam) ? navParam : undefined;
  if (!nav && memberIds.length) nav = "proposal";
  if (!nav) return null;
  const link: ShareLink = { nav };
  if (open && (nav === "members" || nav === "projects")) link.open = open;
  if (q && (nav === "members" || nav === "projects")) link.q = q;
  if (nav === "proposal") {
    if (memberIds.length) link.memberIds = memberIds;
    if (anonymous) link.anonymous = true;
    const needId = parseOpenId(params.get("need"));
    if (needId) link.needId = needId;
  }
  return link;
}

export function serializeShareSearch(link: ShareLink) {
  const params = new URLSearchParams();
  const omitNav = link.nav === "board" && !link.open && !link.q && !link.memberIds?.length && !link.anonymous && !link.needId;
  if (!omitNav) params.set("nav", link.nav);
  if (link.open && (link.nav === "members" || link.nav === "projects")) params.set("open", link.open);
  if (link.q && (link.nav === "members" || link.nav === "projects")) params.set("q", link.q);
  if (link.nav === "proposal") {
    const ids = parseMemberIds((link.memberIds ?? []).join(","));
    if (ids.length) params.set("members", ids.join(","));
    if (link.anonymous) params.set("anonymous", "1");
    // Through the same validator on the way out as on the way in, so a value that
    // could not have been parsed cannot be produced either.
    const needId = link.needId && TARGET_ID_PATTERN.test(link.needId) ? link.needId : undefined;
    if (needId) params.set("need", needId);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function buildShareHref(
  location: Pick<Location, "origin" | "pathname" | "search">,
  link: ShareLink,
) {
  const url = new URL(location.pathname, location.origin);
  const current = new URLSearchParams(location.search);
  for (const key of SHARE_PARAM_KEYS) current.delete(key);
  const next = new URLSearchParams(serializeShareSearch(link).replace(/^\?/, ""));
  next.forEach((value, key) => current.set(key, value));
  url.search = current.toString();
  return url.toString();
}

export function retainedMemberIds(ids: string[], availableIds: Iterable<string>) {
  const available = new Set(availableIds);
  return parseMemberIds(ids.filter((id) => available.has(id)).join(","));
}

/**
 * The address bar for a link, keeping everything the link has no opinion about.
 *
 * `buildShareHref` is for handing someone a URL and takes only origin, pathname and
 * search, so it drops the fragment. This one is for writing the address bar the reader is
 * standing in: an invitation parameter or a fragment is theirs, and only the share keys
 * are ours to replace (#309).
 */
export function shareLocationFor(
  location: Pick<Location, "pathname" | "search" | "hash">,
  link: ShareLink | null,
) {
  const params = new URLSearchParams(location.search);
  for (const key of SHARE_PARAM_KEYS) params.delete(key);
  if (link) {
    new URLSearchParams(serializeShareSearch(link).replace(/^\?/u, "")).forEach((value, key) => params.set(key, value));
  }
  const query = params.toString();
  // Always the pathname: on the deployed site that is `/MOSAIC/`, and a bare `?…` or `""`
  // would be resolved against the current document rather than kept.
  return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

/**
 * Whether moving from one address to another is a place the reader can come back from.
 *
 * The screen is; everything else is the same screen with something else showing. Opening
 * a row, typing in the search box, picking a candidate — each would be its own entry
 * otherwise, and a list read through twenty rows would bury the screen the reader wants
 * back. It also decides the first press after a shared link is followed: the landing is
 * one entry, so closing its drawer must not add another, or Back reopens it (#309).
 *
 * Read off the addresses rather than the state that produced them, so a change the share
 * link cannot express moves nothing.
 */
export function nextHistoryAction(previous: string, next: string): "push" | "replace" | "noop" {
  if (previous === next) return "noop";
  return screenOf(previous) === screenOf(next) ? "replace" : "push";
}

/**
 * The screen an address is on.
 *
 * Through the same gate as `parseShareSearch`, or the two disagree about what an address
 * means. A `?nav=typo` is the board to the reader, and to anything that reads it back; if
 * it were a screen of its own here, following such a link would push on the first pass —
 * the one case that has to move nothing — and Back would land between the typo and the
 * address that replaced it. Absent is the board too, which is what `serializeShareSearch`
 * writes for it.
 *
 * The fragment comes off first: `#/help?nav=members` is a fragment, not a query.
 */
function screenOf(href: string) {
  const withoutHash = href.split("#")[0];
  const query = withoutHash.includes("?") ? withoutHash.slice(withoutHash.indexOf("?") + 1) : "";
  const nav = new URLSearchParams(query).get("nav");
  return isShareNav(nav) ? nav : "board";
}
