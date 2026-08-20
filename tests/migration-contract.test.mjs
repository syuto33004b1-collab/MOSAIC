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
  // Array operators are STABLE, so set checks must stay out of CHECK constraints.
  assert.doesNotMatch(sql, /check \([^)]*(&&|<@|array_position)/);
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
