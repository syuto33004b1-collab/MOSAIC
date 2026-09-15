begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(18);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000371', 'cost-owner@test.local', '{"full_name":"Cost Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000372', 'cost-admin@test.local', '{"full_name":"Cost Admin"}'::jsonb),
  ('11000000-0000-4000-8000-000000000373', 'cost-planner@test.local', '{"full_name":"Cost Planner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000374', 'cost-viewer@test.local', '{"full_name":"Cost Viewer"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000373',
  'Monthly Cost Tenant',
  'monthly-cost-tenant-test',
  '11000000-0000-4000-8000-000000000371',
  '11000000-0000-4000-8000-000000000371',
  '11000000-0000-4000-8000-000000000371'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  ('21000000-0000-4000-8000-000000000373', '11000000-0000-4000-8000-000000000371', 'owner', 'active',
   '11000000-0000-4000-8000-000000000371', '11000000-0000-4000-8000-000000000371'),
  ('21000000-0000-4000-8000-000000000373', '11000000-0000-4000-8000-000000000372', 'admin', 'active',
   '11000000-0000-4000-8000-000000000371', '11000000-0000-4000-8000-000000000371'),
  ('21000000-0000-4000-8000-000000000373', '11000000-0000-4000-8000-000000000373', 'planner', 'active',
   '11000000-0000-4000-8000-000000000371', '11000000-0000-4000-8000-000000000371'),
  ('21000000-0000-4000-8000-000000000373', '11000000-0000-4000-8000-000000000374', 'viewer', 'active',
   '11000000-0000-4000-8000-000000000371', '11000000-0000-4000-8000-000000000371');

insert into app.people (
  id, organization_id, initials, name, role_title, department, location, monthly_cost_yen, created_by, updated_by
) values (
  '31000000-0000-4000-8000-000000000373',
  '21000000-0000-4000-8000-000000000373',
  'CT', '原価 太郎', 'Engineer', '第一本部', '東京', 600000,
  '11000000-0000-4000-8000-000000000371', '11000000-0000-4000-8000-000000000371'
);

create temporary table test_runtime (
  label text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update, delete on table test_runtime to authenticated, service_role;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000371';

select ok(
  (
    select bool_and(member ? 'monthlyCost')
      and bool_and((member ->> 'monthlyCost')::int = 600000)
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000373') -> 'members'
    ) as member
  ),
  'owner get_workspace includes monthlyCost'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000372';

select ok(
  (
    select bool_and(member ? 'monthlyCost')
      and bool_and((member ->> 'monthlyCost')::int = 600000)
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000373') -> 'members'
    ) as member
  ),
  'admin get_workspace includes monthlyCost when it is not hidden'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000373';

select ok(
  (
    select bool_and(not (member ? 'monthlyCost'))
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000373') -> 'members'
    ) as member
  ),
  'planner get_workspace omits monthlyCost even with no role_permissions row'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000374';

select ok(
  (
    select bool_and(not (member ? 'monthlyCost'))
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000373') -> 'members'
    ) as member
  ),
  'viewer get_workspace omits monthlyCost'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000371';

select lives_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000373',
      0,
      '91000000-0000-4000-8000-000000000371',
      '{"rolePermissions":{"upsert":[{"role":"admin","hiddenFieldKeys":["monthlyCost"]}]}}'::jsonb,
      repeat('a', 64)
    )$$,
  'owner may hide monthlyCost on admin'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000372';

select ok(
  (
    select bool_and(not (member ? 'monthlyCost'))
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000373') -> 'members'
    ) as member
  ),
  'admin with hidden monthlyCost does not receive the key'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000373',
      1,
      '91000000-0000-4000-8000-000000000372',
      '{"members":{"upsert":[{"id":"31000000-0000-4000-8000-000000000373","initials":"CT","name":"原価 太郎","role":"Engineer","department":"第一本部","location":"東京","capacity":100,"monthlyCost":1}],"archiveIds":[]}}'::jsonb,
      repeat('b', 64)
    )$$,
  '42501',
  'monthlyCost cannot be changed by this role',
  'hidden admin cannot write monthlyCost'
);

select lives_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000373',
      1,
      '91000000-0000-4000-8000-000000000373',
      '{"members":{"upsert":[{"id":"31000000-0000-4000-8000-000000000373","initials":"CT","name":"原価 改","role":"Engineer","department":"第一本部","location":"東京","capacity":100}],"archiveIds":[]}}'::jsonb,
      repeat('c', 64)
    )$$,
  'hidden admin can save other member fields without monthlyCost'
);

reset role;

select is(
  (
    select person.monthly_cost_yen
    from app.people as person
    where person.id = '31000000-0000-4000-8000-000000000373'
  ),
  600000,
  'omitting monthlyCost on save keeps the stored yen'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000371';

select ok(
  (
    select bool_or(
      item ->> 'entityType' = 'people'
      and (
        item -> 'oldData' ? 'monthly_cost_yen'
        or item -> 'newData' ? 'monthly_cost_yen'
      )
    )
    from jsonb_array_elements(
      public.list_audit_events('21000000-0000-4000-8000-000000000373', 50, null) -> 'items'
    ) as item
  ),
  'owner list_audit_events still includes monthly_cost_yen'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000372';

select ok(
  (
    select bool_and(
      not coalesce(item -> 'oldData', '{}'::jsonb) ? 'monthly_cost_yen'
      and not coalesce(item -> 'newData', '{}'::jsonb) ? 'monthly_cost_yen'
    )
    from jsonb_array_elements(
      public.list_audit_events('21000000-0000-4000-8000-000000000373', 50, null) -> 'items'
    ) as item
  ),
  'hidden admin list_audit_events omits monthly_cost_yen'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000371';

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000373',
      2,
      '91000000-0000-4000-8000-000000000374',
      '{"rolePermissions":{"upsert":[{"role":"admin","readonlyFieldKeys":["monthlyCost"]}]}}'::jsonb,
      repeat('d', 64)
    )$$,
  '22023',
  'monthlyCost cannot be read-only',
  'monthlyCost is refused in readonlyFieldKeys'
);

insert into test_runtime (label, payload)
select 'client', public.create_integration_client(
  '21000000-0000-4000-8000-000000000373',
  'Cost API',
  array['workspace:read']::text[],
  '91000000-0000-4000-8000-000000000375'
);

reset role;
set local role service_role;

select ok(
  (
    select bool_and(not (member ? 'monthlyCost'))
    from jsonb_array_elements(
      public.integration_get_workspace(
        (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'client')
      ) -> 'members'
    ) as member
  ),
  'integration_get_workspace omits monthlyCost even when the issuer is owner'
);

-- become_integration_actor sets app.caller_kind for the whole transaction.
-- Leave it set and the next user save is treated as an integration write.
select set_config('app.caller_kind', '', true);
select set_config('app.integration_client_id', '', true);

reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000371';

select lives_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000373',
      2,
      '91000000-0000-4000-8000-000000000376',
      '{"members":{"upsert":[{"id":"31000000-0000-4000-8000-000000000373","initials":"CT","name":"原価 改","role":"Engineer","department":"第一本部","location":"東京","capacity":100,"monthlyCost":750000}],"archiveIds":[]}}'::jsonb,
      repeat('e', 64)
    )$$,
  'owner can set monthlyCost'
);

reset role;

select is(
  (
    select person.monthly_cost_yen
    from app.people as person
    where person.id = '31000000-0000-4000-8000-000000000373'
  ),
  750000,
  'owner write updates monthly_cost_yen'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000371';

insert into test_runtime (label, payload)
select 'writer', public.create_integration_client(
  '21000000-0000-4000-8000-000000000373',
  'Cost Write API',
  array['workspace:read', 'members:write']::text[],
  '91000000-0000-4000-8000-000000000377'
);

reset role;
set local role service_role;

select throws_ok(
  $$select public.integration_save_workspace(
      (select (payload -> 'client' ->> 'id')::uuid from test_runtime where label = 'writer'),
      3,
      '91000000-0000-4000-8000-000000000378',
      '{"members":{"upsert":[{"id":"31000000-0000-4000-8000-000000000373","initials":"CT","name":"原価 改","role":"Engineer","department":"第一本部","location":"東京","capacity":100,"monthlyCost":1}],"archiveIds":[]}}'::jsonb,
      repeat('f', 64)
    )$$,
  '42501',
  'monthlyCost cannot be changed by this role',
  'integration_save_workspace refuses monthlyCost even with members:write'
);

select set_config('app.caller_kind', '', true);
select set_config('app.integration_client_id', '', true);

reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000371';

select lives_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000373',
      3,
      '91000000-0000-4000-8000-000000000379',
      '{"members":{"upsert":[{"id":"31000000-0000-4000-8000-000000000373","initials":"CT","name":"原価 改","role":"Engineer","department":"第一本部","location":"東京","capacity":100,"monthlyCost":null}],"archiveIds":[]}}'::jsonb,
      repeat('0', 64)
    )$$,
  'owner can clear monthlyCost to null'
);

reset role;

select is(
  (
    select person.monthly_cost_yen
    from app.people as person
    where person.id = '31000000-0000-4000-8000-000000000373'
  ),
  null,
  'owner null write clears monthly_cost_yen'
);

select * from finish();
rollback;
