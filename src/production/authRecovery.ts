const EXPIRED_CODES = new Set(["otp_expired", "flow_state_expired"]);
const ERROR_KEYS = ["error", "error_code", "error_description", "error_uri"] as const;

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
    return "再設定リンクの有効期限が切れています。もう一度メールを送信してください。";
  }
  return "再設定リンクを利用できません。もう一度メールを送信してください。";
}

export function hasAuthCallbackParams(search = "", hash = "") {
  const { query, fragment } = callbackParams(search, hash);
  return Boolean(
    query.get("code")
    || query.get("type") === "recovery"
    || fragment.get("type") === "recovery"
    || fragment.get("access_token"),
  );
}

export function stripAuthCallbackError(href: string) {
  const url = new URL(href);
  for (const key of ERROR_KEYS) url.searchParams.delete(key);
  if (url.hash) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    let changed = false;
    for (const key of ERROR_KEYS) {
      if (fragment.has(key)) {
        fragment.delete(key);
        changed = true;
      }
    }
    if (changed) url.hash = fragment.toString();
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
