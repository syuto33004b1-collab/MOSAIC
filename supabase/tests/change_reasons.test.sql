begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

-- Reasons for cancelling an assignment (#603).
select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000631', 'why-owner@test.local', '{"full_name":"理由 Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000632', 'why-planner@test.local', '{"full_name":"理由 Planner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000633', 'why-viewer@test.local', '{"full_name":"理由 Viewer"}'::jsonb);

update app.profiles set display_name = '理由 Owner' where id = '11000000-0000-4000-8000-000000000631';

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000631',
  'Reason Tenant',
  'reason-tenant-test',
  '11000000-0000-4000-8000-000000000631',
  '11000000-0000-4000-8000-000000000631',
  '11000000-0000-4000-8000-000000000631'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  ('21000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631', 'owner', 'active',
   '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631'),
  ('21000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000632', 'planner', 'active',
   '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631'),
  ('21000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000633', 'viewer', 'active',
   '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631');

insert into app.people (
  id, organization_id, user_id, initials, name, role_title, department,
  location, created_by, updated_by
) values
  ('61000000-0000-4000-8000-000000000631', '21000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000632',
   'RP', 'Reason Planner', 'Engineer', 'Unit A', 'Tokyo',
   '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631'),
  ('61000000-0000-4000-8000-000000000632', '21000000-0000-4000-8000-000000000631', null,
   'RM', 'Reason Member', 'Engineer', 'Unit A', 'Tokyo',
   '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631'),
  ('61000000-0000-4000-8000-000000000633', '21000000-0000-4000-8000-000000000631', null,
   'RO', 'Reason Outsider', 'Engineer', 'Unit B', 'Tokyo',
   '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631'),
  ('61000000-0000-4000-8000-000000000634', '21000000-0000-4000-8000-000000000631', null,
   'RL', 'Reason Leaver', 'Engineer', 'Unit A', 'Tokyo',
   '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631');

insert into app.org_units (id, organization_id, name, created_by, updated_by) values
  ('65000000-0000-4000-8000-000000000631', '21000000-0000-4000-8000-000000000631', 'Unit A',
   '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631'),
  ('65000000-0000-4000-8000-000000000632', '21000000-0000-4000-8000-000000000631', 'Unit B',
   '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631');

insert into app.person_org_units (organization_id, person_id, org_unit_id, is_primary) values
  ('21000000-0000-4000-8000-000000000631', '61000000-0000-4000-8000-000000000631', '65000000-0000-4000-8000-000000000631', true),
  ('21000000-0000-4000-8000-000000000631', '61000000-0000-4000-8000-000000000632', '65000000-0000-4000-8000-000000000631', true),
  ('21000000-0000-4000-8000-000000000631', '61000000-0000-4000-8000-000000000633', '65000000-0000-4000-8000-000000000632', true),
  ('21000000-0000-4000-8000-000000000631', '61000000-0000-4000-8000-000000000634', '65000000-0000-4000-8000-000000000631', true);

insert into app.role_permissions (
  organization_id, role, person_scope, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000631', 'planner', 'unit',
  '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631'
);

insert into app.projects (
  id, organization_id, code, name, status, tone,
  start_date, end_date, progress_percent, demand_headcount, created_by, updated_by
) values (
  '62000000-0000-4000-8000-000000000631', '21000000-0000-4000-8000-000000000631',
  'WHY', 'Reason Project', '進行中', 'blue',
  current_date - 30, current_date + 90, 10, 1,
  '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631'
);

insert into app.assignments (
  id, organization_id, person_id, project_id, start_date, end_date,
  allocation_percent, status, created_by, updated_by
)
select
  ('64000000-0000-4000-8000-00000000063' || n::text)::uuid,
  '21000000-0000-4000-8000-000000000631',
  case n
    when 4 then '61000000-0000-4000-8000-000000000633'::uuid
    when 5 then '61000000-0000-4000-8000-000000000634'::uuid
    else '61000000-0000-4000-8000-000000000632'::uuid
  end,
  '62000000-0000-4000-8000-000000000631',
  current_date + n, current_date + 20 + n, 10, 'confirmed',
  '11000000-0000-4000-8000-000000000631', '11000000-0000-4000-8000-000000000631'
from generate_series(1, 7) as n;

-- 1, 2, 3, 6, 7: Reason Member (unit A). 4: Reason Outsider (unit B). 5: Reason Leaver (unit A).

create temporary table reason_save (
  label text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on table reason_save to authenticated;

insert into reason_save (label, payload) values
  ('cancel_with_reason', jsonb_build_object(
    'assignments', jsonb_build_object('upsert', '[]'::jsonb, 'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000631')),
    'changeReasons', jsonb_build_array(jsonb_build_object(
      'entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000631',
      'action', 'cancel', 'reason', '  顧客都合で開始が来期にずれたため  '
    ))
  ));

select has_table('app', 'change_reasons', 'the reasons table exists');

select ok(
  not has_table_privilege('authenticated', 'app.change_reasons', 'SELECT')
  and not has_table_privilege('authenticated', 'app.change_reasons', 'INSERT')
  and not has_table_privilege('service_role', 'app.change_reasons', 'SELECT')
  and not has_function_privilege('authenticated', 'private.assert_change_reasons_allowed(uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.apply_change_reasons(uuid,jsonb,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.apply_change_reasons(uuid,jsonb,uuid,uuid)', 'EXECUTE'),
  'reasons are reachable only through save_workspace and the history read'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000631';

select lives_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      '93000000-0000-4000-8000-000000000631',
      (select payload from reason_save where label = 'cancel_with_reason'),
      repeat('0', 64)
    )$$,
  'owner cancels an assignment with a reason'
);

select is(
  public.save_workspace(
    '21000000-0000-4000-8000-000000000631',
    (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631') - 1,
    '93000000-0000-4000-8000-000000000631',
    (select payload from reason_save where label = 'cancel_with_reason'),
    repeat('0', 64)
  ) ->> 'replayed',
  'true',
  'the same request replays'
);

select lives_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object('assignments', jsonb_build_object(
        'upsert', '[]'::jsonb,
        'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000632')
      )),
      repeat('0', 64)
    )$$,
  'a cancellation without a reason is still accepted'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object(
        'assignments', jsonb_build_object('upsert', '[]'::jsonb, 'cancelIds', '[]'::jsonb),
        'changeReasons', jsonb_build_array(jsonb_build_object(
          'entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000633', 'action', 'cancel', 'reason', '取消していない'
        ))
      ),
      repeat('0', 64)
    )$$,
  '22023',
  'a change reason must name an assignment cancelled in the same save',
  'a reason must explain a cancellation in the same save'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object(
        'assignments', jsonb_build_object('upsert', '[]'::jsonb, 'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000633')),
        'changeReasons', jsonb_build_array(
          jsonb_build_object('entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000633', 'action', 'cancel', 'reason', '一つ目'),
          jsonb_build_object('entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000633', 'action', 'cancel', 'reason', '二つ目')
        )
      ),
      repeat('0', 64)
    )$$,
  '22023',
  'changeReasons names an assignment more than once',
  'one reason per cancellation'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object(
        'assignments', jsonb_build_object('upsert', '[]'::jsonb, 'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000633')),
        'changeReasons', jsonb_build_array(jsonb_build_object('entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000633', 'action', 'cancel', 'reason', '   '))
      ),
      repeat('0', 64)
    )$$,
  '22023',
  'a change reason must be between 1 and 500 characters',
  'a blank reason is refused'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object(
        'assignments', jsonb_build_object('upsert', '[]'::jsonb, 'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000633')),
        'changeReasons', jsonb_build_array(jsonb_build_object('entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000633', 'action', 'cancel', 'reason', repeat('長', 501)))
      ),
      repeat('0', 64)
    )$$,
  '22023',
  'a change reason must be between 1 and 500 characters',
  'a 501-character reason is refused'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object(
        'assignments', jsonb_build_object('upsert', '[]'::jsonb, 'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000633')),
        'changeReasons', jsonb_build_array(jsonb_build_object('entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000633', 'action', 'cancel', 'reason', '理由', 'by', 'someone'))
      ),
      repeat('0', 64)
    )$$,
  '22023',
  'changeReasons entries take only entityType, entityId, action, and reason',
  'an entry with an extra key is refused'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object(
        'projects', jsonb_build_object('upsert', '[]'::jsonb, 'archiveIds', '[]'::jsonb),
        'changeReasons', jsonb_build_array(jsonb_build_object('entityType', 'project', 'entityId', '62000000-0000-4000-8000-000000000631', 'action', 'archive', 'reason', '理由'))
      ),
      repeat('0', 64)
    )$$,
  '22023',
  'changeReasons supports only assignment cancellations',
  'only assignment cancellations take a reason for now'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object('changeReasons', jsonb_build_object('entityId', 'x')),
      repeat('0', 64)
    )$$,
  '22023',
  'changeReasons must be a JSON array',
  'changeReasons must be an array'
);

-- Archiving the member and giving the reason in one save: the person is still
-- active when the reason is checked.
select lives_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object(
        'members', jsonb_build_object('upsert', '[]'::jsonb, 'archiveIds', jsonb_build_array('61000000-0000-4000-8000-000000000634')),
        'assignments', jsonb_build_object('upsert', '[]'::jsonb, 'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000635')),
        'changeReasons', jsonb_build_array(jsonb_build_object('entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000635', 'action', 'cancel', 'reason', '退職に伴う取消'))
      ),
      repeat('0', 64)
    )$$,
  'a reason can accompany the archive of the member it belongs to'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000632';

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object(
        'assignments', jsonb_build_object('upsert', '[]'::jsonb, 'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000634')),
        'changeReasons', jsonb_build_array(jsonb_build_object('entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000634', 'action', 'cancel', 'reason', '範囲外'))
      ),
      repeat('0', 64)
    )$$,
  '42501',
  'this role cannot record a reason for a member outside its data scope',
  'a unit-scoped planner cannot write a reason about someone outside its unit'
);

select lives_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000631',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000631'),
      gen_random_uuid(),
      jsonb_build_object(
        'assignments', jsonb_build_object('upsert', '[]'::jsonb, 'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000636')),
        'changeReasons', jsonb_build_array(jsonb_build_object('entityType', 'assignment', 'entityId', '64000000-0000-4000-8000-000000000636', 'action', 'cancel', 'reason', '要件が変わったため'))
      ),
      repeat('0', 64)
    )$$,
  'a unit-scoped planner writes a reason about someone in its unit'
);

reset role;

select ok(
  (
    select count(*) = 1
      and min(reason.reason) = '顧客都合で開始が来期にずれたため'
      and min(reason.request_id::text) = '93000000-0000-4000-8000-000000000631'
      and bool_and(reason.created_by = '11000000-0000-4000-8000-000000000631')
    from app.change_reasons as reason
    where reason.assignment_id = '64000000-0000-4000-8000-000000000631'
  ),
  'the reason is stored once, trimmed, with its request and author'
);

select is(
  (select count(*)::integer from app.change_reasons where assignment_id = '64000000-0000-4000-8000-000000000635'),
  1,
  'the reason given with the member archive is stored'
);

select is(
  (select count(*)::integer from app.audit_events where entity_type = 'change_reasons' and organization_id = '21000000-0000-4000-8000-000000000631'),
  3,
  'each stored reason is audited'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000631';

select ok(
  (
    select item ->> 'cancelReason' = '顧客都合で開始が来期にずれたため'
      and item ->> 'cancelReasonByName' = '理由 Owner'
      and item ->> 'cancelReasonAt' is not null
    from jsonb_array_elements(
      public.list_assignment_history('21000000-0000-4000-8000-000000000631', '61000000-0000-4000-8000-000000000632') -> 'items'
    ) as item
    where item ->> 'id' = '64000000-0000-4000-8000-000000000631'
  ),
  'owner reads the reason, who wrote it, and when'
);

select ok(
  (
    select item ? 'cancelReason' and item -> 'cancelReason' = 'null'::jsonb
    from jsonb_array_elements(
      public.list_assignment_history('21000000-0000-4000-8000-000000000631', '61000000-0000-4000-8000-000000000632') -> 'items'
    ) as item
    where item ->> 'id' = '64000000-0000-4000-8000-000000000632'
  ),
  'a cancellation saved without a reason reads as no reason'
);

select ok(
  (
    select not (item ? 'cancelReason')
    from jsonb_array_elements(
      public.list_assignment_history('21000000-0000-4000-8000-000000000631', '61000000-0000-4000-8000-000000000632') -> 'items'
    ) as item
    where item ->> 'id' = '64000000-0000-4000-8000-000000000637'
  ),
  'a row that is not cancelled carries no reason keys'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000632';

select ok(
  (
    select item ->> 'cancelReason' = '顧客都合で開始が来期にずれたため'
    from jsonb_array_elements(
      public.list_assignment_history('21000000-0000-4000-8000-000000000631', '61000000-0000-4000-8000-000000000632') -> 'items'
    ) as item
    where item ->> 'id' = '64000000-0000-4000-8000-000000000631'
  ),
  'a planner reads the reason'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000633';

select ok(
  (
    select count(*) = 5 and bool_and(not (item ? 'cancelReason') and not (item ? 'cancelReasonByName') and not (item ? 'cancelReasonAt'))
    from jsonb_array_elements(
      public.list_assignment_history('21000000-0000-4000-8000-000000000631', '61000000-0000-4000-8000-000000000632') -> 'items'
    ) as item
  ),
  'a viewer reads the rows without any reason keys'
);

reset role;

select throws_ok(
  $$select private.assert_integration_payload_scopes(
      jsonb_populate_record(null::app.integration_clients, '{"scopes":["workspace:read","projects:write"]}'::jsonb),
      '{"changeReasons":[]}'::jsonb
    )$$,
  '42501',
  'assignments:write is required',
  'an integration needs the assignments scope to send reasons'
);

select * from finish();
rollback;
