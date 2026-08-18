const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_VERSION = "m2";

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
  return crypto.subtle.importKey("raw", encoder.encode(`MOSAIC_CHAT_CONTINUATION\0${secret}`), { hash: "SHA-256", name: "HMAC" }, false, ["sign", "verify"]);
}

function signedValue(userId, organizationId, encodedInteractionId) {
  return encoder.encode(`${TOKEN_VERSION}\0${userId}\0${organizationId}\0${encodedInteractionId}`);
}

export async function createContinuationToken(interactionId, userId, organizationId, secret) {
  const encodedInteractionId = base64UrlEncode(encoder.encode(interactionId));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), signedValue(userId, organizationId, encodedInteractionId));
  return `${TOKEN_VERSION}.${encodedInteractionId}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyContinuationToken(token, userId, organizationId, secret) {
  const [version, encodedInteractionId, encodedSignature, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !encodedInteractionId || !encodedSignature || extra !== undefined) return null;
  const interactionIdBytes = base64UrlDecode(encodedInteractionId);
  const signature = base64UrlDecode(encodedSignature);
  if (!interactionIdBytes || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), signature, signedValue(userId, organizationId, encodedInteractionId));
  if (!valid) return null;
  const interactionId = decoder.decode(interactionIdBytes);
  return interactionId && !/\s/u.test(interactionId) ? interactionId : null;
}
