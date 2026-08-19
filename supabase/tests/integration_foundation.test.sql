begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('12000000-0000-4000-8000-000000000001', 'int-owner@test.local', '{"full_name":"Integration Owner"}'::jsonb),
  ('12000000-0000-4000-8000-000000000002', 'int-planner@test.local', '{"full_name":"Integration Planner"}'::jsonb),
  ('12000000-0000-4000-8000-000000000003', 'int-other@test.local', '{"full_name":"Other Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values
  (
    '22000000-0000-4000-8000-000000000001', 'Integration Tenant', 'integration-tenant-test',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001'
  ),
  (
    '22000000-0000-4000-8000-000000000002', 'Other Tenant', 'integration-other-test',
    '12000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000003'
  );

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  (
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'owner', 'active',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001'
  ),
  (
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000002',
    'planner', 'active',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001'
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000003',
    'owner', 'active',
    '12000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000003'
  );

create temporary table test_runtime (
  label text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update, delete on table test_runtime to authenticated;

select ok(
  has_function_privilege('authenticated', 'public.create_integration_client(uuid,text,text[],uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_integration_clients(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.revoke_integration_client(uuid,uuid,uuid)', 'EXECUTE'),
  'owners and admins manage integration clients through authenticated RPCs'
); -- 1

select ok(
  has_function_privilege('service_role', 'public.authorize_integration_request(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.authorize_integration_request(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.authorize_integration_request(text)', 'EXECUTE'),
  'credential verification is service_role only'
); -- 2

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '12000000-0000-4000-8000-000000000002';

select throws_ok(
  $sql$select public.create_integration_client(
    '22000000-0000-4000-8000-000000000001',
    'Planner Bot',
    array['workspace:read']::text[],
    '42000000-0000-4000-8000-000000000001'
  )$sql$,
  '42501',
  'not authorized',
  'planners cannot issue integration credentials'
); -- 3

reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '12000000-0000-4000-8000-000000000001';

select throws_ok(
  $sql$select public.create_integration_client(
    '22000000-0000-4000-8000-000000000001',
    'Write Only',
    array['members:write']::text[],
    '42000000-0000-4000-8000-000000000002'
  )$sql$,
  '22023',
  'workspace:read is required',
  'write scopes still require workspace:read'
); -- 4

insert into test_runtime (label, payload)
select 'created', public.create_integration_client(
  '22000000-0000-4000-8000-000000000001',
  'MCP Server',
  array['workspace:read', 'assignments:write']::text[],
  '42000000-0000-4000-8000-000000000003'
);

select ok(
  (select payload ->> 'secret' ~ '^mosaic_sk_[0-9a-f]{48}$' from test_runtime where label = 'created')
  and (select payload -> 'client' ->> 'status' from test_runtime where label = 'created') = 'active'
  and (select payload -> 'client' ? 'secretHash' from test_runtime where label = 'created') = false,
  'create returns a one-time secret and never the hash'
); -- 5

select is(
  public.create_integration_client(
    '22000000-0000-4000-8000-000000000001',
    'MCP Server',
    array['workspace:read', 'assignments:write']::text[],
    '42000000-0000-4000-8000-000000000003'
  ) ->> 'secret',
  null,
  'a replayed request does not return the plaintext secret'
); -- 6

select ok(
  (
    select bool_and(client ? 'keyPrefix')
      and bool_and(not client ? 'secret')
      and bool_and(not client ? 'secretHash')
    from jsonb_array_elements(
      public.list_integration_clients('22000000-0000-4000-8000-000000000001') -> 'clients'
    ) as client
  ),
  'client lists expose the prefix but not secret material'
); -- 7

select throws_ok(
  $sql$select public.list_integration_clients('22000000-0000-4000-8000-000000000002')$sql$,
  '42501',
  'not authorized',
  'an owner cannot list another tenant integration clients'
); -- 8

reset role;

select ok(
  public.authorize_integration_request(
    (select payload ->> 'secret' from test_runtime where label = 'created')
  ) ->> 'allowed' = 'true'
  and public.authorize_integration_request(
    (select payload ->> 'secret' from test_runtime where label = 'created')
  ) -> 'client' ->> 'organizationId' = '22000000-0000-4000-8000-000000000001',
  'a valid secret authorizes the issuing organization and scopes'
); -- 9

insert into app.integration_rate_windows (client_id, window_started_at, request_count)
select
  (payload -> 'client' ->> 'id')::uuid,
  date_trunc('minute', now()),
  60
from test_runtime
where label = 'created'
on conflict (client_id, window_started_at) do update
set request_count = 60;

select is(
  public.authorize_integration_request(
    (select payload ->> 'secret' from test_runtime where label = 'created')
  ) ->> 'code',
  'RATE_LIMITED',
  'shared integration quota rejects a 61st call in the same minute'
); -- 10

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '12000000-0000-4000-8000-000000000001';

select is(
  public.revoke_integration_client(
    '22000000-0000-4000-8000-000000000001',
    (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'created'),
    '42000000-0000-4000-8000-000000000004'
  ) ->> 'changed',
  'true',
  'owners can revoke an integration client'
); -- 11

select is(
  public.revoke_integration_client(
    '22000000-0000-4000-8000-000000000001',
    (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'created'),
    '42000000-0000-4000-8000-000000000005'
  ) ->> 'changed',
  'false',
  'revoking an already revoked client is a no-op'
); -- 12

reset role;

select throws_ok(
  format(
    $sql$select public.authorize_integration_request(%L)$sql$,
    (select payload ->> 'secret' from test_runtime where label = 'created')
  ),
  '42501',
  'invalid credential',
  'revoked credentials cannot authorize later adapters'
); -- 13

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '12000000-0000-4000-8000-000000000001';

select ok(
  (
    select bool_or(
      item ->> 'entityType' = 'integration_clients'
      and item ->> 'callerKind' = 'user'
      and item -> 'newData' ? 'keyPrefix'
      and not item -> 'newData' ? 'secretHash'
    )
    from jsonb_array_elements(
      public.list_audit_events('22000000-0000-4000-8000-000000000001', 50, null) -> 'items'
    ) as item
  ),
  'credential issuance is audited without storing the secret hash'
); -- 14

reset role;

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relname in ('integration_clients', 'integration_client_requests', 'integration_rate_windows')
      and not (relation.relrowsecurity and relation.relforcerowsecurity)
  ),
  0::bigint,
  'integration tables enable and force RLS'
); -- 15

select ok(
  not has_table_privilege('authenticated', 'app.integration_clients', 'SELECT')
  and not has_table_privilege('service_role', 'app.integration_clients', 'INSERT'),
  'integration tables are reachable only through RPCs'
); -- 16

select * from finish();
rollback;
