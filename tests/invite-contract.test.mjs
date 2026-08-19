import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_INVITE_REDIRECTS,
  errorBody,
  InviteContractError,
  isExistingAuthUserError,
  parseInviteRequest,
  publicInviteResponse,
  sendAuthInvite,
} from "../supabase/functions/invite/contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const redirectTo = ALLOWED_INVITE_REDIRECTS[1];

function invite(overrides = {}) {
  return {
    organizationId: "11111111-1111-4111-8111-111111111111",
    email: "new.member@example.jp",
    role: "planner",
    redirectTo,
    ...overrides,
  };
}

test("validates the invite request and allowlisted redirect", () => {
  assert.deepEqual(parseInviteRequest(invite({ email: "  New.Member@example.jp  " })), {
    action: "send",
    email: "new.member@example.jp",
    organizationId: "11111111-1111-4111-8111-111111111111",
    redirectTo,
    role: "planner",
  });
  assert.throws(
    () => parseInviteRequest(invite({ redirectTo: "https://evil.example/MOSAIC/" })),
    (error) => error instanceof InviteContractError && error.code === "INVALID_REDIRECT",
  );
  assert.throws(
    () => parseInviteRequest(invite({ role: "owner" })),
    (error) => error instanceof InviteContractError && error.code === "INVALID_ROLE",
  );
});

function adminAuth(overrides = {}) {
  return {
    auth: {
      admin: {
        inviteUserByEmail: async () => ({ error: null }),
        listUsers: async () => ({ data: { users: [] }, error: null }),
        deleteUser: async () => ({ error: null }),
        ...overrides,
      },
    },
  };
}

test("treats duplicate Auth users as an existing-account result instead of a leaky failure", async () => {
  assert.equal(isExistingAuthUserError({ code: "email_exists" }), true);
  assert.equal(isExistingAuthUserError({ code: "user_already_exists" }), true);
  assert.equal(await sendAuthInvite(adminAuth({
    inviteUserByEmail: async () => ({ error: { code: "email_exists", message: "already been registered" } }),
    listUsers: async () => ({
      data: { users: [{ id: "user-1", email: "owner@example.jp", email_confirmed_at: "2026-08-01T00:00:00Z" }] },
      error: null,
    }),
  }), { email: "owner@example.jp", redirectTo }), "existing");
  assert.equal(await sendAuthInvite(adminAuth(), { email: "new@example.jp", redirectTo }), "sent");
  await assert.rejects(
    () => sendAuthInvite(adminAuth({
      inviteUserByEmail: async () => ({ error: { code: "unexpected_failure", message: "smtp secret abc" } }),
    }), { email: "new@example.jp", redirectTo }),
    (error) => error instanceof InviteContractError && error.code === "AUTH_INVITE_FAILED" && !error.message.includes("smtp secret"),
  );
});

test("resends an invite email for an unconfirmed Auth user", async () => {
  const deleted = [];
  const invited = [];
  assert.equal(await sendAuthInvite(adminAuth({
    inviteUserByEmail: async (email) => {
      invited.push(email);
      return invited.length === 1
        ? { error: { code: "email_exists", message: "already been registered" } }
        : { error: null };
    },
    listUsers: async () => ({
      data: { users: [{ id: "user-pending", email: "new.member@example.jp", email_confirmed_at: null }] },
      error: null,
    }),
    deleteUser: async (id) => {
      deleted.push(id);
      return { error: null };
    },
  }), { email: "new.member@example.jp", redirectTo }), "sent");
  assert.deepEqual(deleted, ["user-pending"]);
  assert.deepEqual(invited, ["new.member@example.jp", "new.member@example.jp"]);
});

test("returns only the public invitation contract", () => {
  assert.deepEqual(publicInviteResponse({
    id: "inv-1",
    organizationId: "org-1",
    email: "new.member@example.jp",
    role: "planner",
    expiresAt: "2026-08-26T10:00:00Z",
  }, "sent"), {
    invitation: {
      id: "inv-1",
      organizationId: "org-1",
      email: "new.member@example.jp",
      role: "planner",
      expiresAt: "2026-08-26T10:00:00Z",
    },
    authInvite: "sent",
  });
  assert.deepEqual(errorBody("FORBIDDEN", "denied", false), {
    error: { code: "FORBIDDEN", message: "denied", retryable: false },
  });
});

test("keeps the invite function authenticated and secret-key usage server-side", async () => {
  const [configuration, imports, index] = await Promise.all([
    readFile(path.join(root, "supabase", "config.toml"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "invite", "deno.json"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "invite", "index.ts"), "utf8"),
  ]);
  assert.match(configuration, /\[functions\.invite\][\s\S]*verify_jwt = true/);
  assert.match(imports, /jsr:@supabase\/functions-js@2\.112\.3/);
  assert.match(imports, /npm:@supabase\/server@1\.4\.1/);
  assert.doesNotMatch(imports, /@[~^*]/);
  assert.match(index, /withSupabase\(\{ auth: "user" \}/);
  assert.match(index, /rpc\("invite_member"/);
  assert.match(index, /sendAuthInvite\(adminClient\(\)/);
  assert.match(index, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.doesNotMatch(index, /import\.meta\.env/);
  assert.doesNotMatch(index, /VITE_SUPABASE|VITE_APP_ENV|VITE_REQUIRE/);
  assert.doesNotMatch(index, /sb_secret_/);
  const contract = await readFile(path.join(root, "supabase", "functions", "invite", "contract.mjs"), "utf8");
  assert.match(contract, /inviteUserByEmail/);
  assert.match(contract, /deleteUser/);
  assert.match(contract, /mosaic_invite: true/);
  const inviteCall = contract.slice(contract.indexOf("async function inviteUser"), contract.indexOf("export async function sendAuthInvite"));
  assert.doesNotMatch(inviteCall, /\brole\b/);
});
