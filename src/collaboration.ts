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
};

const SHARE_PARAM_KEYS = ["nav", "open", "q", "members", "anonymous"] as const;
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
  }
  return link;
}

export function serializeShareSearch(link: ShareLink) {
  const params = new URLSearchParams();
  const omitNav = link.nav === "board" && !link.open && !link.q && !link.memberIds?.length && !link.anonymous;
  if (!omitNav) params.set("nav", link.nav);
  if (link.open && (link.nav === "members" || link.nav === "projects")) params.set("open", link.open);
  if (link.q && (link.nav === "members" || link.nav === "projects")) params.set("q", link.q);
  if (link.nav === "proposal") {
    const ids = parseMemberIds((link.memberIds ?? []).join(","));
    if (ids.length) params.set("members", ids.join(","));
    if (link.anonymous) params.set("anonymous", "1");
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
