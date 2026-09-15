const STORAGE_KEY = "mosaic.oauth-pending";
export const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;

type OAuthPending = {
  provider: string;
  at: number;
};

function readRaw() {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRaw(value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Private mode can throw. The callback then falls back to password recovery.
  }
}

function parsePending(raw: string | null): OAuthPending | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as { provider?: unknown; at?: unknown };
    if (typeof record.provider !== "string" || record.provider.length === 0) return null;
    if (typeof record.at !== "number" || !Number.isFinite(record.at)) return null;
    if (record.at > Date.now() + 60_000) return null;
    if (Date.now() - record.at > OAUTH_PENDING_TTL_MS) return null;
    return { provider: record.provider, at: record.at };
  } catch {
    return null;
  }
}

export function markOAuthPending(provider: string) {
  writeRaw(JSON.stringify({ provider, at: Date.now() } satisfies OAuthPending));
}

export function peekOAuthPending(): { provider: string } | null {
  const pending = parsePending(readRaw());
  if (!pending) {
    if (readRaw()) writeRaw(null);
    return null;
  }
  return { provider: pending.provider };
}

export function consumeOAuthPending(): { provider: string } | null {
  const pending = peekOAuthPending();
  writeRaw(null);
  return pending;
}
