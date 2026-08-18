const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const ACTION_TOKEN_TTL_MS = 5 * 60 * 1_000;
const ACTION_TOKEN_VERSION = "a1";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function signingKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(`MOSAIC_AI_ACTION\0${secret}`), { hash: "SHA-256", name: "HMAC" }, false, ["sign", "verify"]);
}

export async function createActionToken(action, options) {
  const now = options.now ?? Date.now();
  const ttlMs = Math.max(30_000, Math.min(ACTION_TOKEN_TTL_MS, options.ttlMs ?? ACTION_TOKEN_TTL_MS));
  const expiresAtMs = now + ttlMs;
  const envelope = { version: 1, userId: options.userId, organizationId: options.organizationId, issuedAt: now, expiresAt: expiresAtMs, action };
  const encodedEnvelope = base64UrlEncode(encoder.encode(JSON.stringify(envelope)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(options.secret), encoder.encode(`${ACTION_TOKEN_VERSION}\0${encodedEnvelope}`));
  return { expiresAt: new Date(expiresAtMs).toISOString(), token: `${ACTION_TOKEN_VERSION}.${encodedEnvelope}.${base64UrlEncode(new Uint8Array(signature))}` };
}

export async function verifyActionToken(token, options) {
  if (typeof token !== "string") return null;
  const [version, encodedEnvelope, encodedSignature, extra] = token.split(".");
  if (version !== ACTION_TOKEN_VERSION || !encodedEnvelope || !encodedSignature || extra !== undefined) return null;
  const envelopeBytes = base64UrlDecode(encodedEnvelope);
  const signature = base64UrlDecode(encodedSignature);
  if (!envelopeBytes || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await signingKey(options.secret), signature, encoder.encode(`${ACTION_TOKEN_VERSION}\0${encodedEnvelope}`));
  if (!valid) return null;
  let envelope;
  try {
    envelope = JSON.parse(decoder.decode(envelopeBytes));
  } catch {
    return null;
  }
  if (!isRecord(envelope) || envelope.version !== 1 || envelope.userId !== options.userId || envelope.organizationId !== options.organizationId || typeof envelope.expiresAt !== "number" || envelope.expiresAt <= (options.now ?? Date.now()) || !isRecord(envelope.action)) return null;
  return { action: envelope.action, expiresAt: new Date(envelope.expiresAt).toISOString() };
}
