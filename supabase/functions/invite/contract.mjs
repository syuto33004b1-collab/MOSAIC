const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(["admin", "planner", "viewer"]);
export const ALLOWED_INVITE_REDIRECTS = [
  "http://127.0.0.1:5173/MOSAIC/",
  "https://syuto33004b1-collab.github.io/MOSAIC/",
];

export class InviteContractError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    this.name = "InviteContractError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function errorBody(code, message, retryable = false) {
  return { error: { code, message, retryable } };
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function allowedInviteRedirect(url) {
  return ALLOWED_INVITE_REDIRECTS.includes(url);
}

export function parseInviteRequest(value) {
  const record = asRecord(value);
  if (!record) throw new InviteContractError("INVALID_JSON", "JSONの形式を確認してください。");

  const organizationId = readString(record.organizationId);
  if (!UUID_PATTERN.test(organizationId)) {
    throw new InviteContractError("INVALID_ORGANIZATION", "組織を確認してください。");
  }

  const email = readString(record.email).toLowerCase();
  if (email.length < 3 || email.length > 320 || !email.includes("@") || email.startsWith("@")) {
    throw new InviteContractError("INVALID_EMAIL", "メールアドレスの形式を確認してください。");
  }

  const role = readString(record.role);
  if (!ROLES.has(role)) {
    throw new InviteContractError("INVALID_ROLE", "招待できる権限を確認してください。");
  }

  const redirectTo = readString(record.redirectTo);
  if (!allowedInviteRedirect(redirectTo)) {
    throw new InviteContractError("INVALID_REDIRECT", "許可された戻り先URLを指定してください。");
  }

  const action = readString(record.action) || "send";
  if (action !== "send" && action !== "resend") {
    throw new InviteContractError("INVALID_ACTION", "招待の操作を確認してください。");
  }

  return { action, email, organizationId, redirectTo, role };
}

export function isExistingAuthUserError(error) {
  const record = asRecord(error);
  const code = readString(record?.code).toLowerCase();
  const message = readString(record?.message).toLowerCase();
  return [
    "email_exists",
    "user_already_exists",
    "already_registered",
  ].includes(code)
    || message.includes("already been registered")
    || message.includes("already registered");
}

export function isConfirmedAuthUser(user) {
  const record = asRecord(user);
  return Boolean(record?.email_confirmed_at);
}

export async function findAuthUserByEmail(admin, email) {
  const normalized = email.toLowerCase();
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw new InviteContractError("AUTH_INVITE_FAILED", "招待メールを送れませんでした。通信状況を確認してください。", 503, true);
    }
    const users = Array.isArray(data?.users) ? data.users : [];
    const found = users.find((user) => readString(asRecord(user)?.email).toLowerCase() === normalized);
    if (found) return found;
    if (users.length < 200) return undefined;
  }
  return undefined;
}

async function inviteUser(admin, { email, redirectTo }) {
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { mosaic_invite: true },
  });
  if (!error) return "sent";
  if (isExistingAuthUserError(error)) return "existing";
  const record = asRecord(error);
  const code = readString(record?.code);
  if (code === "over_email_send_rate_limit" || record?.status === 429) {
    throw new InviteContractError("RATE_LIMITED", "メールを連続して送れません。しばらくしてからもう一度お試しください。", 429, true);
  }
  throw new InviteContractError("AUTH_INVITE_FAILED", "招待メールを送れませんでした。通信状況を確認してください。", 503, true);
}

export async function sendAuthInvite(admin, { email, redirectTo }) {
  const first = await inviteUser(admin, { email, redirectTo });
  if (first === "sent") return "sent";

  const existing = await findAuthUserByEmail(admin, email);
  if (!existing || isConfirmedAuthUser(existing)) return "existing";

  const { error: deleteError } = await admin.auth.admin.deleteUser(existing.id);
  if (deleteError) {
    throw new InviteContractError("AUTH_INVITE_FAILED", "招待メールを送れませんでした。通信状況を確認してください。", 503, true);
  }
  return inviteUser(admin, { email, redirectTo });
}

export function publicInviteResponse(invitation, authInvite) {
  return {
    invitation: {
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    },
    authInvite,
  };
}
