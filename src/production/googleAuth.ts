export function isGoogleAuthEnabled(value = import.meta.env.VITE_ENABLE_GOOGLE_AUTH) {
  return String(value ?? "").trim().toLowerCase() === "true";
}
