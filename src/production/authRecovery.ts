const EXPIRED_CODES = new Set(["otp_expired", "flow_state_expired"]);
const ERROR_KEYS = ["error", "error_code", "error_description", "error_uri"] as const;
const CALLBACK_KEYS = ["code", "type", "access_token", "refresh_token", "token_type", "expires_in", "expires_at"];

function callbackParams(search: string, hash: string) {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return { query, fragment };
}

export function appAuthRedirectUrl(origin = window.location.origin, baseUrl = import.meta.env.BASE_URL) {
  return new URL(baseUrl || "/", origin).href;
}

export function passwordRecoveryLinkError(search = "", hash = "") {
  const { query, fragment } = callbackParams(search, hash);
  const error = query.get("error") ?? fragment.get("error");
  const code = query.get("error_code") ?? fragment.get("error_code");
  if (!error && !code) return "";
  if (EXPIRED_CODES.has(code ?? "") || error === "otp_expired") {
    return "リンクの有効期限が切れています。もう一度メールを送信するか、管理者に再送を依頼してください。";
  }
  return "リンクを利用できません。もう一度メールを送信するか、管理者に連絡してください。";
}

export function isInviteCallback(search = "", hash = "") {
  const { query, fragment } = callbackParams(search, hash);
  return query.get("type") === "invite" || fragment.get("type") === "invite";
}

export function isInviteOnboardingUser(user?: { user_metadata?: Record<string, unknown> } | null) {
  return user?.user_metadata?.mosaic_invite === true;
}

export function hasAuthCallbackParams(search = "", hash = "") {
  const { query, fragment } = callbackParams(search, hash);
  return Boolean(
    query.get("code")
    || query.get("type") === "recovery"
    || query.get("type") === "invite"
    || fragment.get("type") === "recovery"
    || fragment.get("type") === "invite"
    || fragment.get("access_token"),
  );
}

export function stripAuthCallbackError(href: string) {
  return stripLocationParams(href, ERROR_KEYS);
}

export function stripAuthCallback(href: string) {
  return stripLocationParams(href, [...ERROR_KEYS, ...CALLBACK_KEYS]);
}

function stripLocationParams(href: string, keys: readonly string[]) {
  const url = new URL(href);
  for (const key of keys) url.searchParams.delete(key);
  if (url.hash) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    let changed = false;
    for (const key of keys) {
      if (fragment.has(key)) {
        fragment.delete(key);
        changed = true;
      }
    }
    if (changed) url.hash = fragment.toString();
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
