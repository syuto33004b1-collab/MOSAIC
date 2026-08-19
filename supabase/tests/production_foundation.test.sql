begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(65);

-- Deterministic actors and tenants. The auth trigger creates matching profiles.
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'owner-a@test.local', '{"full_name":"Owner A"}'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'admin-a@test.local', '{"full_name":"Admin A"}'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'planner-a@test.local', '{"full_name":"Planner A"}'::jsonb),
  ('10000000-0000-4000-8000-000000000004', 'viewer-a@test.local', '{"full_name":"Viewer A"}'::jsonb),
  ('10000000-0000-4000-8000-000000000005', 'owner-b@test.local', '{"full_name":"Owner B"}'::jsonb),
  ('10000000-0000-4000-8000-000000000006', 'invitee-a@test.local', '{"full_name":"Invitee A"}'::jsonb),
  ('10000000-0000-4000-8000-000000000007', 'creator@test.local', '{"full_name":"Creator"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values
  (
    '20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a-test',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b-test',
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005'
  );

insert into app.organization_memberships (
  id, organization_id, user_id, role, status, created_by, updated_by
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'owner', 'active',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'admin', 'active',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'planner', 'active',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    'viewer', 'active',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000005',
    'owner', 'active',
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005'
  );

insert into app.people (
  id, organization_id, initials, name, role_title, department, location, created_by, updated_by
) values (
  '60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'OA', 'Owner A', 'Engineer', 'Operations', 'Tokyo',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into app.projects (
  id, organization_id, code, name, status, tone, owner_person_id,
  start_date, end_date, progress_percent, demand_headcount, created_by, updated_by
) values (
  '62000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'TEST-A', 'Tenant A Project', '進行中', 'blue',
  '60000000-0000-4000-8000-000000000001',
  current_date, current_date + 30, 25, 1,
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into app.staffing_needs (
  id, organization_id, project_id, role_title, start_date, end_date,
  allocation_percent, status, draft_person_id, created_by, updated_by
) values (
  '63000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001',
  'Engineer', current_date, current_date + 30, 50, 'filled',
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into app.assignments (
  id, organization_id, person_id, project_id, staffing_need_id, start_date, end_date,
  allocation_percent, status, confirmed_at, confirmed_by, created_by, updated_by
) values (
  '64000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000001',
  current_date, current_date + 30, 50, 'confirmed', now(),
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into app.skills (id, organization_id, name, created_by, updated_by) values (
  '61000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'PostgreSQL',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into app.person_skills (organization_id, person_id, skill_id, created_by) values (
  '20000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into app.staffing_need_skills (
  organization_id, staffing_need_id, skill_id, created_by
) values (
  '20000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into app.organization_invitations (
  id, organization_id, email, role, expires_at, created_by, updated_by
) values (
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'invitee-a@test.local', 'planner', now() + interval '7 days',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

create temporary table test_runtime (
  label text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update, delete on table test_runtime to authenticated;

-- Catalog and privilege contract.
select has_table(
  'app', 'organization_creation_requests',
  'organization creation requests have a durable idempotency ledger'
); -- 1

select ok(
  to_regprocedure('public.create_organization(text,uuid)') is not null,
  'request-id organization creation overload exists'
); -- 2

select ok(
  has_table_privilege('authenticated', 'app.organizations', 'SELECT'),
  'authenticated can select only the Realtime organization signal'
); -- 3

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relkind in ('r', 'p')
      and (
        has_table_privilege('authenticated', relation.oid, 'INSERT')
        or has_table_privilege('authenticated', relation.oid, 'UPDATE')
        or has_table_privilege('authenticated', relation.oid, 'DELETE')
      )
  ),
  0::bigint,
  'authenticated has no direct app DML'
); -- 4

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relkind in ('r', 'p')
      and (
        has_table_privilege('service_role', relation.oid, 'INSERT')
        or has_table_privilege('service_role', relation.oid, 'UPDATE')
        or has_table_privilege('service_role', relation.oid, 'DELETE')
      )
  ),
  0::bigint,
  'service_role cannot bypass RPC invariants with direct app DML'
); -- 5

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relkind in ('r', 'p')
      and not (relation.relrowsecurity and relation.relforcerowsecurity)
  ),
  0::bigint,
  'every app table enables and forces RLS'
); -- 6

select is(
  (
    select count(*)
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'app'
  ),
  1::bigint,
  'Realtime publishes exactly one app table'
); -- 7

select is(
  (
    select count(*)
    from pg_trigger
    where not tgisinternal
      and tgname in ('skills_audit', 'person_skills_audit', 'staffing_need_skills_audit')
  ),
  3::bigint,
  'skills and both skill link tables are audited'
); -- 8

select is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (array[
        'get_my_context', 'create_organization', 'get_workspace', 'save_workspace',
        'invite_member', 'list_organization_invitations', 'revoke_organization_invitation',
        'accept_invitation', 'list_organization_members', 'manage_organization_member',
        'list_audit_events', 'update_my_profile',
        'create_integration_client', 'list_integration_clients', 'revoke_integration_client',
        'create_webhook_endpoint', 'list_webhook_endpoints', 'revoke_webhook_endpoint'
      ]::text[])
      and not procedure.prosecdef
  ),
  0::bigint,
  'every allowlisted public RPC is SECURITY DEFINER'
); -- 9

select is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (array[
        'get_my_context', 'create_organization', 'get_workspace', 'save_workspace',
        'invite_member', 'list_organization_invitations', 'revoke_organization_invitation',
        'accept_invitation', 'list_organization_members', 'manage_organization_member',
        'list_audit_events', 'update_my_profile',
        'create_integration_client', 'list_integration_clients', 'revoke_integration_client',
        'create_webhook_endpoint', 'list_webhook_endpoints', 'revoke_webhook_endpoint'
      ]::text[])
      and has_function_privilege('anon', procedure.oid, 'EXECUTE')
  ),
  0::bigint,
  'anon cannot execute production RPCs'
); -- 10

select is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (array[
        'get_my_context', 'create_organization', 'get_workspace', 'save_workspace',
        'invite_member', 'list_organization_invitations', 'revoke_organization_invitation',
        'accept_invitation', 'list_organization_members', 'manage_organization_member',
        'list_audit_events', 'update_my_profile',
        'create_integration_client', 'list_integration_clients', 'revoke_integration_client',
        'create_webhook_endpoint', 'list_webhook_endpoints', 'revoke_webhook_endpoint'
      ]::text[])
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  ),
  18::bigint,
  'authenticated can execute every allowlisted RPC overload'
); -- 11

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $sql$select public.get_workspace('20000000-0000-4000-8000-000000000002')$sql$,
  '42501', 'not authorized',
  'an owner cannot read another tenant workspace'
); -- 12

select throws_ok(
  $sql$select public.save_workspace('20000000-0000-4000-8000-000000000002', 0, '40000000-0000-4000-8000-000000000001', '{}'::jsonb, repeat('0', 64))$sql$,
  '42501', 'not authorized',
  'an owner cannot save another tenant workspace'
); -- 13

select throws_ok(
  $sql$select public.manage_organization_member('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005', 'viewer', 'active', '40000000-0000-4000-8000-000000000002')$sql$,
  '42501', 'not authorized',
  'an owner cannot manage another tenant membership'
); -- 14

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000004';

select ok(
  (public.get_workspace('20000000-0000-4000-8000-000000000001') -> 'organization') ? 'id',
  'viewer can read its active tenant workspace'
); -- 15

select throws_ok(
  $sql$select public.save_workspace('20000000-0000-4000-8000-000000000001', 0, '40000000-0000-4000-8000-000000000003', '{}'::jsonb, repeat('0', 64))$sql$,
  '42501', 'not authorized',
  'viewer cannot save a workspace'
); -- 16

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select is(
  (public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 0,
    '40000000-0000-4000-8000-000000000004', '{}'::jsonb, repeat('0', 64)
  ) ->> 'revision')::bigint,
  1::bigint,
  'planner can commit an authorized workspace change'
); -- 17

select is(
  (public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 0,
    '40000000-0000-4000-8000-000000000004', '{}'::jsonb, repeat('0', 64)
  ) ->> 'replayed')::boolean,
  true,
  'same request ID replays a committed save after response loss'
); -- 18

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000005',
    '{"members":{"upsert":[],"archiveIds":["60000000-0000-4000-8000-000000000001"]}}'::jsonb,
    repeat('0', 64)
  )$sql$,
  '42501', 'only owners and admins may change members',
  'planner cannot mutate the people directory'
); -- 19

select throws_ok(
  $sql$select public.save_workspace('20000000-0000-4000-8000-000000000001', 0, '40000000-0000-4000-8000-000000000006', '{}'::jsonb, repeat('1', 64))$sql$,
  '40001', 'workspace revision conflict',
  'stale expected revision is rejected'
); -- 20

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 0,
    '40000000-0000-4000-8000-000000000004',
    '{"projects":{}}'::jsonb, repeat('0', 64)
  )$sql$,
  '22023', 'p_request_id was already used for a different payload',
  'request ID is bound to the original payload'
); -- 21

reset role;

select is(
  (select workspace_revision from app.organizations where id = '20000000-0000-4000-8000-000000000001'),
  1::bigint,
  'replay and rejected writes do not advance workspace revision'
); -- 22

select is(
  (select count(*) from app.workspace_commits where organization_id = '20000000-0000-4000-8000-000000000001'),
  1::bigint,
  'one durable commit exists for the replayed request'
); -- 23

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';

insert into test_runtime (label, payload)
select 'create-first', public.create_organization(
  'Retry Safe Org', '40000000-0000-4000-8000-000000000007'
);

select is(
  (select (payload ->> 'replayed')::boolean from test_runtime where label = 'create-first'),
  false,
  'first request-ID organization creation is not a replay'
); -- 24

insert into test_runtime (label, payload)
select 'create-replay', public.create_organization(
  'Retry Safe Org', '40000000-0000-4000-8000-000000000007'
);

select is(
  (select payload #>> '{organization,id}' from test_runtime where label = 'create-replay'),
  (select payload #>> '{organization,id}' from test_runtime where label = 'create-first'),
  'organization creation retry returns the original tenant'
); -- 25

select is(
  (select (payload ->> 'replayed')::boolean from test_runtime where label = 'create-replay'),
  true,
  'organization creation retry is marked replayed'
); -- 26

select throws_ok(
  $sql$select public.create_organization('Different Name', '40000000-0000-4000-8000-000000000007')$sql$,
  '22023', 'p_request_id was already used for a different organization name',
  'organization request ID cannot be reused for another name'
); -- 27

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select throws_ok(
  $sql$select public.revoke_organization_invitation(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000008'
  )$sql$,
  '42501', 'not authorized',
  'planner cannot revoke an organization invitation'
); -- 28

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  jsonb_array_length(
    public.list_organization_invitations('20000000-0000-4000-8000-000000000001') -> 'invitations'
  ),
  1,
  'owner can list a pending invitation'
); -- 29

insert into test_runtime (label, payload)
select 'revoke-first', public.revoke_organization_invitation(
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000009'
);

select is(
  (select (payload ->> 'changed')::boolean from test_runtime where label = 'revoke-first'),
  true,
  'owner can revoke a pending invitation'
); -- 30

select is(
  (select (payload ->> 'accessRevision')::bigint from test_runtime where label = 'revoke-first'),
  1::bigint,
  'invitation revocation advances access revision once'
); -- 31

select is(
  jsonb_array_length(
    public.list_organization_invitations('20000000-0000-4000-8000-000000000001') -> 'invitations'
  ),
  0,
  'revoked invitation leaves the pending list'
); -- 32

insert into test_runtime (label, payload)
select 'revoke-replay', public.revoke_organization_invitation(
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000009'
);

select is(
  (select (payload ->> 'changed')::boolean from test_runtime where label = 'revoke-replay'),
  false,
  'repeated invitation revocation is a no-op'
); -- 33

select is(
  (select (payload ->> 'accessRevision')::bigint from test_runtime where label = 'revoke-replay'),
  1::bigint,
  'revocation replay does not advance access revision'
); -- 34

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000006';

select throws_ok(
  $sql$select public.accept_invitation('50000000-0000-4000-8000-000000000001')$sql$,
  'P0002', 'invitation not found or not available',
  'recipient cannot accept a revoked invitation'
); -- 35

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  public.manage_organization_member(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'planner', 'suspended',
    '40000000-0000-4000-8000-000000000010'
  ) #>> '{member,status}',
  'suspended',
  'owner can suspend a planner through the serialized RPC'
); -- 36

select throws_ok(
  $sql$select public.invite_member(
    '20000000-0000-4000-8000-000000000001',
    'planner-a@test.local', 'planner'
  )$sql$,
  '23514', 'a suspended member must be reactivated by an owner or admin',
  'suspended membership cannot be bypassed with a new invitation'
); -- 37

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';

select throws_ok(
  $sql$select public.invite_member(
    '20000000-0000-4000-8000-000000000001',
    'future-admin@test.local', 'admin'
  )$sql$,
  '42501', 'only owners may invite administrators',
  'admin cannot create another admin through the invitation path'
); -- 38

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000011',
    '{"members":{"upsert":[],"archiveIds":["60000000-0000-4000-8000-000000000001"]}}'::jsonb,
    repeat('0', 64)
  )$sql$,
  '22023', 'active assignments cannot reference inactive members or archived projects',
  'member archive rolls back when an active assignment would dangle'
); -- 39

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000012',
    '{"projects":{"upsert":[],"archiveIds":["62000000-0000-4000-8000-000000000001"]},"assignments":{"upsert":[],"cancelIds":["64000000-0000-4000-8000-000000000001"]}}'::jsonb,
    repeat('0', 64)
  )$sql$,
  '22023', 'active staffing needs cannot reference archived projects',
  'project archive rolls back when an active staffing need would dangle'
); -- 40

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000025',
    '{
      "members":{"archiveIds":["60000000-0000-4000-8000-000000000001"]},
      "assignments":{"cancelIds":["64000000-0000-4000-8000-000000000001"]},
      "needs":{"cancelIds":["63000000-0000-4000-8000-000000000001"]}
    }'::jsonb,
    repeat('0', 64)
  )$sql$,
  '22023', 'active projects cannot reference inactive owner members',
  'authenticated RPC cannot archive an active project owner after cancelling child work'
); -- 41

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000014',
    jsonb_build_object(
      'assignments', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '64000000-0000-4000-8000-000000000001',
          'personId', '60000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'staffingNeedId', '63000000-0000-4000-8000-000000000001',
          'startDate', (current_date - 1)::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'confirmed'
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'active assignment periods must be contained by their projects',
  'authenticated RPC payload cannot place an assignment outside project dates'
); -- 42

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000015',
    jsonb_build_object(
      'needs', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '63000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'role', 'Engineer',
          'skills', jsonb_build_array('PostgreSQL'),
          'startDate', (current_date - 1)::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'filled',
          'draftPersonId', '60000000-0000-4000-8000-000000000001'
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'active staffing need periods must be contained by their projects',
  'authenticated RPC payload cannot place a staffing need outside project dates'
); -- 43

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000016',
    jsonb_build_object(
      'needs', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '63000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'role', 'Engineer',
          'skills', jsonb_build_array('PostgreSQL'),
          'startDate', current_date::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'filled',
          'draftPersonId', null
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'planned or filled staffing needs require one matching active assignment and qualified draft person',
  'filled need cannot omit its draft person through a direct RPC payload'
); -- 44

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000017',
    jsonb_build_object(
      'assignments', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '64000000-0000-4000-8000-000000000001',
          'personId', '60000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'staffingNeedId', '63000000-0000-4000-8000-000000000001',
          'startDate', (current_date + 1)::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'confirmed'
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'planned or filled staffing needs require one matching active assignment and qualified draft person',
  'linked assignment must contain the entire staffing-need period'
); -- 45

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000018',
    jsonb_build_object(
      'assignments', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '64000000-0000-4000-8000-000000000001',
          'personId', '60000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'staffingNeedId', '63000000-0000-4000-8000-000000000001',
          'startDate', current_date::text,
          'endDate', (current_date + 30)::text,
          'allocation', 40,
          'status', 'confirmed'
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'planned or filled staffing needs require one matching active assignment and qualified draft person',
  'linked assignment allocation must meet the staffing need'
); -- 46

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000019',
    jsonb_build_object(
      'needs', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '63000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'role', 'Architect',
          'skills', jsonb_build_array('PostgreSQL'),
          'startDate', current_date::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'filled',
          'draftPersonId', '60000000-0000-4000-8000-000000000001'
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'planned or filled staffing needs require one matching active assignment and qualified draft person',
  'draft person role must match the staffing need'
); -- 47

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000020',
    jsonb_build_object(
      'needs', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '63000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'role', 'Engineer',
          'skills', jsonb_build_array('PostgreSQL', 'Rust'),
          'startDate', current_date::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'filled',
          'draftPersonId', '60000000-0000-4000-8000-000000000001'
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'planned or filled staffing needs require one matching active assignment and qualified draft person',
  'draft person must possess every required staffing-need skill'
); -- 48

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000021',
    jsonb_build_object(
      'needs', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '63000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'role', 'Engineer',
          'skills', jsonb_build_array('PostgreSQL'),
          'startDate', current_date::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'open',
          'draftPersonId', null
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'open or cancelled staffing needs cannot retain a draft person or active linked assignment',
  'open need cannot retain an active linked assignment'
); -- 49

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000022',
    jsonb_build_object(
      'assignments', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '64000000-0000-4000-8000-000000000002',
          'personId', '60000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'staffingNeedId', '63000000-0000-4000-8000-000000000001',
          'startDate', current_date::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'draft'
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'a staffing need can have at most one active linked assignment',
  'one-person fulfillment model rejects a second active assignment for one need'
); -- 50

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000023',
    jsonb_build_object(
      'assignments', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '64000000-0000-4000-8000-000000000001',
          'personId', '60000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'staffingNeedId', '63000000-0000-4000-8000-000000000001',
          'startDate', current_date::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'draft'
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'planned or filled staffing needs require one matching active assignment and qualified draft person',
  'filled need cannot be backed by only a draft assignment'
); -- 51

select throws_ok(
  $sql$select public.save_workspace(
    '20000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000024',
    jsonb_build_object(
      'needs', jsonb_build_object(
        'upsert', jsonb_build_array(jsonb_build_object(
          'id', '63000000-0000-4000-8000-000000000001',
          'projectId', '62000000-0000-4000-8000-000000000001',
          'role', 'Engineer',
          'skills', jsonb_build_array('PostgreSQL'),
          'startDate', current_date::text,
          'endDate', (current_date + 30)::text,
          'allocation', 50,
          'status', 'planned',
          'draftPersonId', '60000000-0000-4000-8000-000000000001'
        )),
        'cancelIds', '[]'::jsonb
      )
    ),
    repeat('0', 64)
  )$sql$,
  '22023', 'planned or filled staffing needs require one matching active assignment and qualified draft person',
  'planned need cannot be backed by only a confirmed assignment'
); -- 52

insert into test_runtime (label, payload)
select 'detach-need', public.save_workspace(
  '20000000-0000-4000-8000-000000000001', 1,
  '40000000-0000-4000-8000-000000000013',
  jsonb_build_object(
    'assignments', jsonb_build_object(
      'upsert', jsonb_build_array(jsonb_build_object(
        'id', '64000000-0000-4000-8000-000000000001',
        'personId', '60000000-0000-4000-8000-000000000001',
        'projectId', '62000000-0000-4000-8000-000000000001',
        'staffingNeedId', null,
        'startDate', current_date::text,
        'endDate', (current_date + 30)::text,
        'allocation', 50,
        'status', 'confirmed',
        'label', null
      )),
      'cancelIds', '[]'::jsonb
    ),
    'needs', jsonb_build_object(
      'upsert', jsonb_build_array(jsonb_build_object(
        'id', '63000000-0000-4000-8000-000000000001',
        'projectId', '62000000-0000-4000-8000-000000000001',
        'role', 'Engineer',
        'skills', jsonb_build_array('PostgreSQL'),
        'startDate', current_date::text,
        'endDate', (current_date + 30)::text,
        'allocation', 50,
        'status', 'open',
        'draftPersonId', null
      )),
      'cancelIds', '[]'::jsonb
    )
  ),
  repeat('0', 64)
);

select is(
  (select (payload ->> 'revision')::bigint from test_runtime where label = 'detach-need'),
  2::bigint,
  'explicit JSON null assignment update commits at the next revision'
); -- 53

reset role;

select is(
  (
    select staffing_need_id
    from app.assignments
    where id = '64000000-0000-4000-8000-000000000001'
  ),
  null::uuid,
  'explicit JSON null detaches an assignment from its staffing need'
); -- 54

select throws_ok(
  $sql$update app.organization_memberships
    set role = 'admin'
    where organization_id = '20000000-0000-4000-8000-000000000002'
      and user_id = '10000000-0000-4000-8000-000000000005'$sql$,
  '23514', 'an organization must retain at least one active owner',
  'database invariant rejects removal of the sole active owner'
); -- 55

update app.organizations
set archived_at = now()
where id = '20000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $sql$select public.list_organization_members('20000000-0000-4000-8000-000000000001')$sql$,
  '42501', 'not authorized',
  'archived organization cannot be read through member listing'
); -- 56

select throws_ok(
  $sql$select public.list_audit_events('20000000-0000-4000-8000-000000000001', 50, null)$sql$,
  '42501', 'not authorized',
  'archived organization cannot expose audit history to former members'
); -- 57

select is(
  (select count(*) from app.organizations where id = '20000000-0000-4000-8000-000000000001'),
  0::bigint,
  'archived organization is hidden by the Realtime SELECT policy'
); -- 58

reset role;

select is(
  (
    select entity_key ->> 'personId'
    from app.audit_events
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and entity_type = 'person_skills'
    order by id desc
    limit 1
  ),
  '60000000-0000-4000-8000-000000000001',
  'person-skill audit stores the composite person key'
); -- 59

select is(
  (
    select entity_key ->> 'skillId'
    from app.audit_events
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and entity_type = 'person_skills'
    order by id desc
    limit 1
  ),
  '61000000-0000-4000-8000-000000000001',
  'person-skill audit stores the composite skill key'
); -- 60

select ok(
  (
    select old_data is null and new_data is not null
    from app.audit_events
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and entity_type = 'person_skills'
    order by id desc
    limit 1
  ),
  'skill-link audit preserves target and before/after data without a workspace payload dump'
); -- 61

select ok(
  to_regprocedure('public.create_organization(text)') is null,
  'legacy organization creation overload cannot bypass request-id idempotency'
); -- 62

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select is(
  public.update_my_profile('計画 花子') ->> 'displayName',
  '計画 花子',
  'authenticated users can update their own display name'
); -- 63

reset role;

select is(
  (select display_name from app.profiles where id = '10000000-0000-4000-8000-000000000003'),
  '計画 花子',
  'profile display name persists after update_my_profile'
); -- 64

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select throws_ok(
  $sql$select public.update_my_profile('   ')$sql$,
  '22023',
  'a display name is required',
  'blank display names are rejected'
); -- 65

select * from finish();
rollback;
