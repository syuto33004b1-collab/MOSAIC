import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = await readFile(path.join(root, "supabase", "migrations", "20260915210000_feedback.sql"), "utf8");
const integration = await readFile(path.join(root, "supabase", "migrations", "20260915220000_integration_submit_feedback.sql"), "utf8");
const workspace = await readFile(path.join(root, "supabase", "migrations", "20260817065503_mosaic_production_foundation.sql"), "utf8");

test("keeps feedback off the workspace snapshot", () => {
  assert.match(workspace, /create or replace function public\.get_workspace/u);
  assert.match(workspace, /create or replace function public\.save_workspace/u);
  assert.doesNotMatch(workspace, /feedback/u);
  assert.match(migration, /create table app\.feedback/u);
  assert.match(migration, /revoke all on table app\.feedback from public, anon, authenticated, service_role/u);
  assert.doesNotMatch(migration, /grant execute on function public\.submit_feedback[\s\S]+to service_role/u);
  assert.doesNotMatch(migration, /grant execute on function private\.normalize_feedback_screen/u);
});

test("stores unknown screens instead of rejecting them, and pages on seq", () => {
  assert.match(migration, /private\.normalize_feedback_screen/u);
  assert.match(migration, /else 'unknown'/u);
  assert.doesNotMatch(migration, /'operations'/u);
  assert.match(migration, /seq bigint generated always as identity/u);
  assert.match(migration, /p_before is null or feedback\.seq < p_before/u);
  assert.match(migration, /feedback is limited to 20 submissions per hour/u);
  assert.match(migration, /pg_advisory_xact_lock/u);
  assert.match(migration, /unique \(organization_id, request_id\)/u);
  assert.match(migration, /and feedback\.id = p_id/u);
});

test("lets the MCP adapter reuse submit_feedback without granting it to service_role", () => {
  assert.match(integration, /create or replace function public\.integration_submit_feedback\(/u);
  assert.match(integration, /p_client_id uuid,\s*p_request_id uuid,\s*p_body text/u);
  assert.match(integration, /private\.become_integration_actor\(p_client_id\)/u);
  assert.match(integration, /return public\.submit_feedback\(/u);
  assert.match(integration, /'mcp'/u);
  assert.doesNotMatch(integration, /p_source_screen/u);
  assert.doesNotMatch(integration, /p_organization_id/u);
  assert.match(integration, /grant execute on function public\.integration_submit_feedback\(uuid, uuid, text\)\s+to service_role/u);
  assert.doesNotMatch(integration, /grant execute on function public\.submit_feedback/u);
});
