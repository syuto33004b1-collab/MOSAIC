begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('13000000-0000-4000-8000-000000000001', 'api-owner@test.local', '{"full_name":"API Owner"}'::jsonb),
  ('13000000-0000-4000-8000-000000000002', 'api-planner@test.local', '{"full_name":"API Planner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '23000000-0000-4000-8000-000000000001', 'API Tenant', 'api-tenant-test',
  '13000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  (
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    'owner', 'active',
    '13000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001'
  ),
  (
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000002',
    'planner', 'active',
    '13000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001'
  );

create temporary table test_runtime (
  label text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update, delete on table test_runtime to authenticated, service_role;

select ok(
  has_function_privilege('authenticated', 'public.create_webhook_endpoint(uuid,text,text,text[],uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_webhook_endpoints(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.revoke_webhook_endpoint(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.integration_get_workspace(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_webhook_outbox(uuid,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.integration_get_workspace(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.integration_save_workspace(uuid,bigint,uuid,jsonb,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_webhook_outbox(uuid,integer)', 'EXECUTE'),
  'webhook management is authenticated; impersonated workspace and outbox are service_role only'
); -- 1

select ok(
  private.webhook_url_is_public_https('https://hooks.example.com/mosaic')
  and not private.webhook_url_is_public_https('http://hooks.example.com/mosaic')
  and not private.webhook_url_is_public_https('https://localhost/hook')
  and not private.webhook_url_is_public_https('https://127.0.0.1/hook')
  and not private.webhook_url_is_public_https('https://10.1.2.3/hook')
  and not private.webhook_url_is_public_https('https://169.254.169.254/latest'),
  'webhook URLs must be public https destinations'
); -- 2

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '13000000-0000-4000-8000-000000000002';

select throws_ok(
  $sql$select public.create_webhook_endpoint(
    '23000000-0000-4000-8000-000000000001',
    'Planner Hook',
    'https://hooks.example.com/planner',
    array['workspace.committed']::text[],
    '43000000-0000-4000-8000-000000000001'
  )$sql$,
  '42501',
  'not authorized',
  'planners cannot register webhook endpoints'
); -- 3

reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '13000000-0000-4000-8000-000000000001';

select throws_ok(
  $sql$select public.create_webhook_endpoint(
    '23000000-0000-4000-8000-000000000001',
    'Local Hook',
    'https://127.0.0.1/hook',
    array['workspace.committed']::text[],
    '43000000-0000-4000-8000-000000000002'
  )$sql$,
  '22023',
  'webhook URL must be a public https address',
  'loopback webhook URLs are rejected'
); -- 4

insert into test_runtime (label, payload)
select 'webhook', public.create_webhook_endpoint(
  '23000000-0000-4000-8000-000000000001',
  'BI Hook',
  'https://hooks.example.com/mosaic',
  array['workspace.committed', 'member.changed']::text[],
  '43000000-0000-4000-8000-000000000003'
);

select ok(
  (select payload ->> 'secret' ~ '^[0-9a-f]{64}$' from test_runtime where label = 'webhook')
  and (select payload -> 'endpoint' ? 'signingSecret' from test_runtime where label = 'webhook') = false
  and (select payload -> 'endpoint' ->> 'url' from test_runtime where label = 'webhook') = 'https://hooks.example.com/mosaic',
  'create returns a one-time signing secret and never stores it in the public endpoint json'
); -- 5

select ok(
  (
    select bool_and(not endpoint ? 'secret')
      and bool_and(not endpoint ? 'signingSecret')
      and bool_and(endpoint ? 'url')
    from jsonb_array_elements(
      public.list_webhook_endpoints('23000000-0000-4000-8000-000000000001') -> 'endpoints'
    ) as endpoint
  ),
  'webhook lists never expose signing secrets'
); -- 6

insert into test_runtime (label, payload)
select 'client', public.create_integration_client(
  '23000000-0000-4000-8000-000000000001',
  'External API',
  array['workspace:read', 'members:write']::text[],
  '43000000-0000-4000-8000-000000000004'
);

reset role;

select ok(
  (select public.integration_get_workspace(
    (payload -> 'client' ->> 'id')::uuid
  ) -> 'organization' ->> 'id'
  from test_runtime where label = 'client') = '23000000-0000-4000-8000-000000000001',
  'service_role can load a workspace for an impersonated integration client'
); -- 7

update app.organizations
set workspace_revision = workspace_revision + 1
where id = '23000000-0000-4000-8000-000000000001';

set local role service_role;

insert into test_runtime (label, payload)
select 'claimed', public.claim_webhook_outbox('23000000-0000-4000-8000-000000000001', 5);

select ok(
  (
    select bool_or(
      item ->> 'eventType' = 'workspace.committed'
      and jsonb_array_length(item -> 'endpoints') >= 1
      and item -> 'endpoints' -> 0 ? 'secret'
    )
    from jsonb_array_elements(
      (select payload -> 'items' from test_runtime where label = 'claimed')
    ) as item
  ),
  'claiming the outbox returns matching endpoint secrets to the delivery worker'
); -- 8

select ok(
  (select public.complete_webhook_outbox(
    (select (payload -> 'items' -> 0 ->> 'id')::bigint from test_runtime where label = 'claimed'),
    true,
    null
  ) ->> 'delivered') = 'true',
  'successful delivery marks the outbox item complete'
); -- 9

reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '13000000-0000-4000-8000-000000000001';

select is(
  public.revoke_webhook_endpoint(
    '23000000-0000-4000-8000-000000000001',
    (select (payload -> 'endpoint' ->> 'id')::uuid from test_runtime where label = 'webhook'),
    '43000000-0000-4000-8000-000000000005'
  ) ->> 'changed',
  'true',
  'owners can revoke a webhook endpoint'
); -- 10

select is(
  public.revoke_webhook_endpoint(
    '23000000-0000-4000-8000-000000000001',
    (select (payload -> 'endpoint' ->> 'id')::uuid from test_runtime where label = 'webhook'),
    '43000000-0000-4000-8000-000000000006'
  ) ->> 'changed',
  'false',
  'revoking an already revoked endpoint is a no-op'
); -- 11

reset role;

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relname in ('webhook_endpoints', 'webhook_outbox')
      and not (relation.relrowsecurity and relation.relforcerowsecurity)
  ),
  0::bigint,
  'webhook tables enable and force RLS'
); -- 12

select ok(
  not has_table_privilege('authenticated', 'app.webhook_endpoints', 'SELECT')
  and not has_table_privilege('service_role', 'app.webhook_outbox', 'INSERT'),
  'webhook tables are reachable only through RPCs'
); -- 13

select throws_ok(
  $sql$select public.integration_save_workspace(
    (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'client'),
    0,
    '43000000-0000-4000-8000-000000000007',
    '{"projects":{"upsert":[],"archiveIds":[]}}'::jsonb,
    repeat('0', 64)
  )$sql$,
  '42501',
  'projects:write is required',
  'impersonated save still enforces payload scopes'
); -- 14

select * from finish();
rollback;
