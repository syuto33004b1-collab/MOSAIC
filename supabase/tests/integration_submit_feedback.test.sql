begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000381', 'mcp-owner@test.local', '{"full_name":"MCP Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000382', 'mcp-planner@test.local', '{"full_name":"MCP Planner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000383', 'mcp-other@test.local', '{"full_name":"MCP Other"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values
  (
    '21000000-0000-4000-8000-000000000381',
    'MCP Feedback Tenant',
    'mcp-feedback-tenant-test',
    '11000000-0000-4000-8000-000000000381',
    '11000000-0000-4000-8000-000000000381',
    '11000000-0000-4000-8000-000000000381'
  ),
  (
    '21000000-0000-4000-8000-000000000382',
    'MCP Other Tenant',
    'mcp-feedback-other-test',
    '11000000-0000-4000-8000-000000000383',
    '11000000-0000-4000-8000-000000000383',
    '11000000-0000-4000-8000-000000000383'
  );

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  ('21000000-0000-4000-8000-000000000381', '11000000-0000-4000-8000-000000000381', 'owner', 'active',
   '11000000-0000-4000-8000-000000000381', '11000000-0000-4000-8000-000000000381'),
  ('21000000-0000-4000-8000-000000000381', '11000000-0000-4000-8000-000000000382', 'planner', 'active',
   '11000000-0000-4000-8000-000000000381', '11000000-0000-4000-8000-000000000381'),
  ('21000000-0000-4000-8000-000000000382', '11000000-0000-4000-8000-000000000383', 'owner', 'active',
   '11000000-0000-4000-8000-000000000383', '11000000-0000-4000-8000-000000000383');

create temporary table test_runtime (
  label text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update, delete on table test_runtime to authenticated, service_role;

insert into app.integration_clients (
  id, organization_id, name, key_prefix, secret_hash, scopes, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000381',
  '21000000-0000-4000-8000-000000000381',
  'Planner MCP',
  'bbbbbbbbbbbb',
  repeat('b', 64),
  array['workspace:read', 'assignments:write']::text[],
  '11000000-0000-4000-8000-000000000382',
  '11000000-0000-4000-8000-000000000382'
);

insert into test_runtime (label, payload)
values (
  'planner_client',
  jsonb_build_object('client', jsonb_build_object('id', '61000000-0000-4000-8000-000000000381'))
);

select ok(
  has_function_privilege('service_role', 'public.integration_submit_feedback(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.integration_submit_feedback(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.integration_submit_feedback(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.submit_feedback(uuid,uuid,text,text)', 'EXECUTE'),
  'only service_role may call the integration wrapper; submit_feedback stays human-only'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000381';

insert into test_runtime (label, payload)
select 'owner_client', public.create_integration_client(
  '21000000-0000-4000-8000-000000000381',
  'Owner MCP',
  array['workspace:read']::text[],
  '91000000-0000-4000-8000-000000000381'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000383';

insert into test_runtime (label, payload)
select 'other_client', public.create_integration_client(
  '21000000-0000-4000-8000-000000000382',
  'Other MCP',
  array['workspace:read']::text[],
  '91000000-0000-4000-8000-000000000383'
);

select throws_ok(
  $$select public.integration_submit_feedback(
      (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'owner_client'),
      '91000000-0000-4000-8000-000000000384',
      'authenticated からは呼べない'
    )$$,
  '42501',
  null,
  'authenticated cannot execute the integration wrapper'
);

reset role;
set local role service_role;

select lives_ok(
  $$select public.integration_submit_feedback(
      (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'planner_client'),
      '91000000-0000-4000-8000-000000000385',
      'MCP から送った気づき'
    )$$,
  'the issuer may submit through the wrapper'
);

select is(
  public.integration_submit_feedback(
    (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'planner_client'),
    '91000000-0000-4000-8000-000000000385',
    'MCP から送った気づき'
  ) ->> 'replayed',
  'true',
  'the same request id replays instead of inserting again'
);

select set_config('app.caller_kind', '', true);
select set_config('app.integration_client_id', '', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

reset role;

select ok(
  (
    select bool_and(audit.caller_kind = 'integration')
      and bool_and(audit.action = 'insert')
      and bool_and(audit.entity_type = 'feedback')
      and bool_and(audit.actor_user_id = '11000000-0000-4000-8000-000000000382')
      and bool_and(audit.request_id = '91000000-0000-4000-8000-000000000385')
      and bool_and(
        audit.integration_client_id = (
          select (payload -> 'client' ->> 'id')::uuid
          from test_runtime
          where label = 'planner_client'
        )
      )
    from app.audit_events as audit
    where audit.organization_id = '21000000-0000-4000-8000-000000000381'
      and audit.entity_type = 'feedback'
  ),
  'audit records the integration client, issuer, and request on the insert'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000381';

select ok(
  (
    select jsonb_array_length(public.list_feedback('21000000-0000-4000-8000-000000000381', 50, null) -> 'items') = 1
      and bool_and(item ->> 'sourceScreen' = 'unknown')
      and bool_and(item ->> 'createdByName' = 'MCP Planner')
      and bool_and(item ->> 'createdByRole' = 'planner')
      and bool_and(not (item ? 'email'))
    from jsonb_array_elements(
      public.list_feedback('21000000-0000-4000-8000-000000000381', 50, null) -> 'items'
    ) as item
  ),
  'owner sees the MCP row as unknown, authored by the issuer, without email'
);

reset role;
set local role service_role;

select lives_ok(
  $$select public.integration_submit_feedback(
      (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'other_client'),
      '91000000-0000-4000-8000-000000000386',
      '他組織の本文'
    )$$,
  'another tenant client writes only into its own organization'
);

select set_config('app.caller_kind', '', true);
select set_config('app.integration_client_id', '', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000381';

select is(
  jsonb_array_length(public.list_feedback('21000000-0000-4000-8000-000000000381', 50, null) -> 'items'),
  1,
  'the other tenant write does not appear in the first organization'
);

reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000383';

select is(
  jsonb_array_length(public.list_feedback('21000000-0000-4000-8000-000000000382', 50, null) -> 'items'),
  1,
  'the other owner sees only their organization'
);

reset role;

insert into app.feedback (
  organization_id, request_id, body, source_screen, created_by, updated_by, created_at
)
select
  '21000000-0000-4000-8000-000000000381',
  ('91000000-0000-4000-8000-00000003' || lpad(n::text, 4, '0'))::uuid,
  'rate ' || n,
  'board',
  '11000000-0000-4000-8000-000000000382',
  '11000000-0000-4000-8000-000000000382',
  now()
from generate_series(1, 19) as n;

set local role service_role;

select throws_ok(
  $$select public.integration_submit_feedback(
      (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'planner_client'),
      '91000000-0000-4000-8000-000000000399',
      '21件目'
    )$$,
  '54000',
  'feedback is limited to 20 submissions per hour',
  'the hourly cap is charged to the issuer'
);

select is(
  public.integration_submit_feedback(
    (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'planner_client'),
    '91000000-0000-4000-8000-000000000385',
    'MCP から送った気づき'
  ) ->> 'replayed',
  'true',
  'a replay does not consume the hourly cap'
);

select set_config('app.caller_kind', '', true);
select set_config('app.integration_client_id', '', true);
reset role;

update app.organization_memberships
set role = 'viewer'
where organization_id = '21000000-0000-4000-8000-000000000381'
  and user_id = '11000000-0000-4000-8000-000000000382';

set local role service_role;

select throws_ok(
  $$select public.integration_submit_feedback(
      (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'planner_client'),
      '91000000-0000-4000-8000-000000000387',
      '降格後は書けない'
    )$$,
  '42501',
  'invalid credential',
  'a demoted issuer stops the credential instead of escalating'
);

select * from finish();
rollback;
