import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrations = path.join(root, "supabase", "migrations");

async function productionMigration() {
  const files = (await readdir(migrations)).filter((name) => name.endsWith("_mosaic_production_foundation.sql"));
  assert.equal(files.length, 1, "expected one production foundation migration");
  return readFile(path.join(migrations, files[0]), "utf8");
}

test("locks shared writes behind an atomic revision and idempotency boundary", async () => {
  const sql = await productionMigration();
  assert.match(sql, /create table app\.workspace_commits/i);
  assert.match(sql, /request_id uuid not null/i);
  assert.match(sql, /workspace_revision = organization\.workspace_revision \+ 1/i);
  assert.match(sql, /organization\.workspace_revision = p_expected_revision/i);
  assert.match(sql, /errcode = '40001'/i);
  assert.match(sql, /server_payload_digest <> v_server_digest/i);
});

test("keeps tenant data private and exposes only authenticated RPCs", async () => {
  const sql = await productionMigration();
  const rlsTables = sql.match(/enable row level security/gi) ?? [];
  assert.ok(rlsTables.length >= 12, "expected RLS on every tenant and audit table");
  assert.match(sql, /revoke all on all tables in schema app from public, anon, authenticated/i);
  assert.match(sql, /grant select on app\.organizations to authenticated/i);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all) on app\.[a-z_]+ to authenticated/i);
  assert.match(sql, /grant execute on function public\.save_workspace[\s\S]+to authenticated/i);
  assert.match(sql, /grant execute on function public\.manage_organization_member\(uuid, uuid, text, text, uuid\) to authenticated/i);
  assert.match(sql, /only owners and admins may change members/i);
  assert.match(sql, /alter publication supabase_realtime add table app\.organizations/i);
});

test("separates access changes and rejects cross-tenant member administration", async () => {
  const sql = await productionMigration();
  assert.match(sql, /access_revision bigint not null default 0/i);
  assert.match(sql, /create or replace function public\.manage_organization_member/i);
  assert.match(sql, /if v_actor_role is null or v_actor_role not in \('owner', 'admin'\)/i);
  assert.match(sql, /self membership changes require another active owner/i);
  assert.match(sql, /user_id uuid not null references auth\.users \(id\) on delete restrict/i);
  assert.match(sql, /access_revision = organization\.access_revision \+ 1/i);
  assert.match(sql, /a suspended membership requires administrator reactivation/i);
  assert.match(sql, /recheck access after acquiring the organization lock/i);
});

test("makes tenant creation and invitation revocation retry-safe without direct DML", async () => {
  const sql = await productionMigration();
  assert.match(sql, /create table app\.organization_creation_requests/i);
  assert.match(sql, /create or replace function public\.create_organization\([\s\S]+p_request_id uuid/i);
  assert.match(sql, /p_request_id was already used for a different organization name/i);
  assert.match(sql, /select organization\.\*, membership\.role as membership_role\s+into v_replay/i);
  assert.doesNotMatch(sql, /into v_organization\s*,\s*v_role/i);
  assert.doesNotMatch(sql, /create or replace function public\.create_organization\(p_name text\)/i);
  assert.doesNotMatch(sql, /grant execute on function public\.create_organization\(text\) to authenticated/i);
  assert.match(sql, /create or replace function public\.list_organization_invitations/i);
  assert.match(sql, /create or replace function public\.revoke_organization_invitation/i);
  assert.match(sql, /only owners may invite administrators/i);
  assert.match(sql, /grant execute on function public\.revoke_organization_invitation\(uuid, uuid, uuid\) to authenticated/i);
  assert.match(sql, /revoke all on all tables in schema app from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(sql, /grant all on all tables in schema app to service_role/i);
});

test("audits skill links and rejects dangling workspace references", async () => {
  const sql = await productionMigration();
  const payloadArrayFunction = sql.match(/create or replace function private\.payload_array[\s\S]*?\$function\$;/i)?.[0] ?? "";
  assert.match(payloadArrayFunction, /language plpgsql\s+stable/i);
  assert.doesNotMatch(payloadArrayFunction, /language plpgsql\s+immutable/i);
  assert.match(sql, /entity_key jsonb not null/i);
  assert.match(sql, /create trigger skills_audit/i);
  assert.match(sql, /create trigger person_skills_audit/i);
  assert.match(sql, /create trigger staffing_need_skills_audit/i);
  assert.match(sql, /if not \(v_item \? 'staffingNeedId'\) then/i);
  assert.match(sql, /staffing_need_id = excluded\.staffing_need_id/i);
  assert.match(sql, /active assignments cannot reference inactive members or archived projects/i);
  assert.match(sql, /active staffing needs cannot reference archived projects/i);
  assert.match(sql, /active projects cannot reference inactive owner members/i);
  assert.match(sql, /project\.owner_person_id is not null[\s\S]+owner_person\.id is null or not owner_person\.is_active/i);
  assert.match(sql, /active assignment periods must be contained by their projects/i);
  assert.match(sql, /active staffing need periods must be contained by their projects/i);
  assert.match(sql, /assignment\.start_date < project\.start_date[\s\S]+assignment\.end_date > project\.end_date/i);
  assert.match(sql, /need\.start_date < project\.start_date[\s\S]+need\.end_date > project\.end_date/i);
  assert.match(sql, /open or cancelled staffing needs cannot retain a draft person or active linked assignment/i);
  assert.match(sql, /need\.status in \('open', 'cancelled'\)[\s\S]+need\.draft_person_id is not null/i);
  assert.match(sql, /a staffing need can have at most one active linked assignment/i);
  assert.match(sql, /group by assignment\.staffing_need_id[\s\S]+having count\(\*\) > 1/i);
  assert.match(sql, /planned or filled staffing needs require one matching active assignment and qualified draft person/i);
  assert.match(sql, /need\.status in \('planned', 'filled'\)/i);
  assert.match(sql, /lower\(btrim\(draft_person\.role_title\)\) <> lower\(btrim\(need\.role_title\)\)/i);
  assert.match(sql, /need\.status = 'planned' and linked_assignment\.status = 'draft'/i);
  assert.match(sql, /need\.status = 'filled' and linked_assignment\.status = 'confirmed'/i);
  assert.match(sql, /linked_assignment\.start_date <= need\.start_date/i);
  assert.match(sql, /linked_assignment\.allocation_percent >= need\.allocation_percent/i);
  assert.match(sql, /qualified_skill\.skill_id = required_skill\.skill_id/i);
  const finalIntegrityCheck = sql.indexOf("planned or filled staffing needs require one matching active assignment and qualified draft person");
  const commitLedgerWrite = sql.indexOf("insert into app.workspace_commits", finalIntegrityCheck);
  assert.ok(finalIntegrityCheck > 0 && commitLedgerWrite > finalIntegrityCheck, "final integrity checks must precede the commit ledger write");
});

test("lets authenticated users update only their own display name", async () => {
  const sql = await readFile(path.join(migrations, "20260819034515_update_my_profile.sql"), "utf8");
  assert.match(sql, /create or replace function public\.update_my_profile\(p_display_name text\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(sql, /where profile\.id = v_user_id/);
  assert.match(sql, /revoke all on function public\.update_my_profile\(text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.update_my_profile\(text\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.update_my_profile\(text\) to anon/);
  assert.doesNotMatch(sql, /grant execute on function public\.update_my_profile\(text\) to public/);
});

test("keeps personal favorites off the shared workspace payload", async () => {
  const sql = await readFile(path.join(migrations, "20260819180000_favorites.sql"), "utf8");
  assert.match(sql, /create table app\.favorites/);
  assert.match(sql, /create or replace function public\.list_favorites\(p_organization_id uuid\)/);
  assert.match(sql, /create or replace function public\.set_favorite\(/);
  assert.match(sql, /favorite limit is 100/);
  assert.match(sql, /revoke all on table app\.favorites from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.list_favorites\(uuid\) to authenticated/);
  assert.match(sql, /grant execute on function public\.set_favorite\(uuid, text, uuid, boolean\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.list_favorites\(uuid\) to anon/);
  assert.doesNotMatch(sql, /workspace_revision/);
});

test("layers role permissions on one read and one write choke point", async () => {
  const sql = await readFile(path.join(migrations, "20260820090000_role_permissions.sql"), "utf8");
  assert.match(sql, /create table app\.role_permissions/);
  assert.match(sql, /role text not null check \(role in \('admin', 'planner', 'viewer'\)\)/);
  assert.match(sql, /person_scope in \('organization', 'unit_subtree', 'unit', 'self'\)/);
  assert.match(sql, /cardinality\(hidden_field_keys\) <= 100/);
  assert.match(sql, /a field key cannot be both hidden and read-only/);
  assert.match(sql, /rolePermissions\.disabledFeatures contains an unsupported feature/);
  assert.match(sql, /revoke all on table app\.role_permissions from public, anon, authenticated, service_role/);
  assert.match(sql, /create trigger role_permissions_audit/);
  // get_workspace is the single read path for Web UI, AI chat, the external API, and MCP.
  assert.match(sql, /return private\.scoped_workspace\(p_organization_id, v_result\)/);
  assert.match(sql, /perform private\.assert_role_permissions_allow\(p_organization_id, p_payload\)/);
  assert.match(sql, /perform private\.apply_role_permissions\(p_organization_id, p_payload, auth\.uid\(\)\)/);
  // Only owners may relax administrator limits, so a restricted admin cannot escalate.
  assert.match(sql, /only owners may change administrator permissions/);
  assert.match(sql, /rolePermissions cannot be changed through an integration/);
  // A field the caller may not write keeps its stored value through the per-entity replace.
  assert.match(sql, /and not \(field_value\.field_id::text = any \(v_locked\)\)/);
  assert.match(sql, /a restricted custom field cannot be changed by this role/);
  assert.match(sql, /favorites are disabled for this role/);
  assert.match(sql, /this role cannot assign a member outside its data scope/);
  assert.doesNotMatch(sql, /grant execute on function private\./);
  assert.doesNotMatch(sql, /grant .* on table app\.role_permissions/);
});

test("keeps the role permission feature allow list on the table too", async () => {
  const sql = await readFile(path.join(migrations, "20260820120000_role_permission_feature_check.sql"), "utf8");
  assert.match(sql, /alter table app\.role_permissions/);
  assert.match(sql, /add constraint role_permissions_disabled_features_allowed check/);
  assert.match(sql, /disabled_features <@ array\[/);
  for (const feature of ["searchScenes", "savedReports", "profileRequests", "opportunities", "favorites"]) {
    assert.ok(sql.includes(`'${feature}'`), `expected ${feature} in the allow list`);
  }
});

test("keeps the outbound mcp client on approved addresses with its own audit trail", async () => {
  const sql = await readFile(path.join(migrations, "20260820150000_external_mcp_client.sql"), "utf8");
  assert.match(sql, /create table app\.mcp_servers/);
  assert.match(sql, /create table app\.mcp_call_logs/);
  assert.match(sql, /server_key text not null check \(server_key ~ '\^\[a-z\]\[a-z0-9_\]\{0,15\}\$'\)/);
  assert.match(sql, /url like 'https:\/\/%'/);
  assert.match(sql, /revoke all on table app\.mcp_servers from public, anon, authenticated, service_role/);
  assert.match(sql, /revoke all on table app\.mcp_call_logs from public, anon, authenticated, service_role/);
  assert.match(sql, /create trigger mcp_servers_audit/);
  // No outbound secret may be stored: the plaintext lives in the function environment.
  assert.doesNotMatch(sql, /secret_hash|signing_secret|auth_token|secret text/);
  assert.match(sql, /MCP_SECRET_<SERVER_KEY uppercased>/);
  // begin_mcp_call is the only source of an address, and it gates the tool too.
  assert.match(sql, /'url', v_server\.url/);
  assert.match(sql, /this tool is not approved for the mcp server/);
  assert.match(sql, /external mcp calls are limited to 20 per minute/);
  assert.match(sql, /mcp server url must not target a private or loopback host/);
  assert.match(sql, /mcp server url must not embed credentials/);
  assert.match(sql, /mcp server url must use a hostname, not an IP literal/);
  // Range checks only apply to a full dotted quad, so fe8-api.example.com survives.
  assert.match(sql, /v_host ~ '\^\[0-9\]\{1,3\}\(\\.\[0-9\]\{1,3\}\)\{3\}\$'/);
  assert.match(sql, /active mcp servers are limited to 5 per organization/);
  // list_mcp_tools is the member-facing surface and must not leak the address.
  const listTools = sql.match(/create or replace function public\.list_mcp_tools[\s\S]*?\$function\$;/)?.[0] ?? "";
  assert.ok(listTools.length > 0, "expected list_mcp_tools in the migration");
  assert.doesNotMatch(listTools, /server\.url/);
  assert.match(sql, /grant execute on function public\.begin_mcp_call\(uuid, text, text\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function private\./);
});

test("every comment, revoke, and grant names a signature the migration declares", async () => {
  // A mismatched arity makes `comment on function` fail at apply time and aborts
  // the whole migration. Catch it here instead of in CI's database job.
  const files = (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort();
  const declared = new Set([
    // Created by renaming public.save_workspace in 20260819061800_skill_taxonomy.sql.
    "private.save_workspace_core(uuid, bigint, uuid, jsonb, text)",
  ]);
  const referenced = [];

  const parameterTypes = (params) => params
    .split(",")
    .map((part) => part.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .map((part) => part.replace(/\s+default\s+.*$/iu, "").split(" ").slice(1).join(" "))
    .filter(Boolean);

  for (const file of files) {
    const sql = await readFile(path.join(migrations, file), "utf8");
    const declarations = /create or replace function\s+((?:public|private)\.\w+)\(([\s\S]*?)\)\s*returns/gi;
    for (const match of sql.matchAll(declarations)) {
      declared.add(`${match[1]}(${parameterTypes(match[2]).join(", ")})`);
    }
    const references = /^(?:comment on function|revoke all on function|grant execute on function)\s+((?:public|private)\.\w+)\(([^)]*)\)/gim;
    for (const match of sql.matchAll(references)) {
      referenced.push(`${file}: ${match[1]}(${match[2].replace(/\s+/gu, " ").trim()})`);
    }
  }

  assert.ok(declared.size >= 30, `expected the migrations to declare many functions, saw ${declared.size}`);
  assert.ok(referenced.length >= 40, `expected many signature references, saw ${referenced.length}`);
  const unknown = referenced.filter((entry) => !declared.has(entry.slice(entry.indexOf(": ") + 2)));
  assert.deepEqual(unknown, []);
});

test("binds an integration credential to its issuer without escalating", async () => {
  const sql = await readFile(path.join(migrations, "20260820180000_integration_actor_no_fallback.sql"), "utf8");
  assert.match(sql, /create or replace function private\.become_integration_actor\(p_client_id uuid\)/);
  assert.match(sql, /and membership\.user_id = v_client\.created_by/);
  assert.match(sql, /and membership\.role in \('owner', 'admin', 'planner'\)/);
  // The fallback that picked an arbitrary administrator must be gone.
  assert.doesNotMatch(sql, /order by case membership\.role when 'owner' then 0 else 1 end/);
  assert.doesNotMatch(sql, /role in \('owner', 'admin'\)\s*\r?\n\s*order by/);
  // Owners need to see why a credential stopped; it is computed, never stored.
  assert.match(sql, /'actorEligible', exists \(/);
  assert.doesNotMatch(sql, /alter table app\.integration_clients/);
  assert.match(sql, /grant execute on function public\.list_integration_clients\(uuid\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function private\./);
});

test("makes external mcp access switchable by role permissions", async () => {
  const sql = await readFile(path.join(migrations, "20260820200000_external_mcp_role_permission.sql"), "utf8");
  // The allow list lives in a table constraint and in the apply function; both must move together.
  assert.equal((sql.match(/'externalMcp'/gu) ?? []).length >= 2, true, "expected externalMcp in both the constraint and the apply validation");
  assert.match(sql, /drop constraint role_permissions_disabled_features_allowed/);
  assert.match(sql, /add constraint role_permissions_disabled_features_allowed check/);
  // Refused before the address is resolved and before an audit row exists.
  assert.match(sql, /external mcp servers are disabled for this role/);
  const beginCall = sql.match(/create or replace function public\.begin_mcp_call[\s\S]*?\$function\$;/)?.[0] ?? "";
  assert.ok(beginCall.length > 0, "expected begin_mcp_call in the migration");
  const guard = beginCall.indexOf("externalMcp");
  const insert = beginCall.indexOf("insert into app.mcp_call_logs");
  const address = beginCall.indexOf("'url', v_server.url");
  assert.ok(guard > 0 && insert > guard, "the permission guard must precede the audit row");
  assert.ok(address > guard, "the permission guard must precede handing out the address");
  // Hidden from the model entirely, not merely refused on call.
  assert.match(sql, /return jsonb_build_object\('servers', '\[\]'::jsonb\)/);
});

test("holds an external write until a person confirms it", async () => {
  const sql = await readFile(path.join(migrations, "20260820220000_external_mcp_confirmed_writes.sql"), "utf8");
  assert.match(sql, /add column write_tools text\[\] not null default '\{\}'::text\[\]/);
  assert.match(sql, /check \(write_tools <@ allowed_tools\)/);
  assert.match(sql, /add column is_write boolean not null default false/);
  // The read path must not be a way into a write.
  assert.match(sql, /this tool writes and needs an explicit confirmation/);
  // Proposing must not return an address; only resume does.
  const propose = sql.match(/create or replace function public\.propose_mcp_call[\s\S]*?\$function\$;/)?.[0] ?? "";
  const resume = sql.match(/create or replace function public\.resume_mcp_call[\s\S]*?\$function\$;/)?.[0] ?? "";
  assert.ok(propose.length > 0 && resume.length > 0, "expected both write RPCs in the migration");
  assert.doesNotMatch(propose, /'url'/);
  assert.match(resume, /'url', v_server\.url/);
  // Single use, and a withdrawn approval stops a stale confirmation.
  assert.match(resume, /call_log\.status = 'pending'/);
  assert.match(resume, /call_log\.actor_user_id = v_actor_id/);
  assert.match(resume, /no pending external write for this confirmation/);
  assert.match(resume, /this tool is no longer approved for writing on the mcp server/);
  // The six-argument create is replaced, not left behind alongside the new one.
  assert.match(sql, /drop function if exists public\.create_mcp_server\(uuid, text, text, text, text\[\], uuid\)/);
  assert.doesNotMatch(sql, /grant execute on function private\./);
});
