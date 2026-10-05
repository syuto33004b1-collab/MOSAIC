begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

-- Assignment history (#600).
select plan(19);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000601', 'hist-owner@test.local', '{"full_name":"履歴 Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000602', 'hist-planner@test.local', '{"full_name":"履歴 Planner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000603', 'hist-viewer@test.local', '{"full_name":"履歴 Viewer"}'::jsonb),
  ('11000000-0000-4000-8000-000000000604', 'hist-other@test.local', '{"full_name":"履歴 Other"}'::jsonb);

update app.profiles set display_name = '履歴 Owner' where id = '11000000-0000-4000-8000-000000000601';

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values
  (
    '21000000-0000-4000-8000-000000000601',
    'History Tenant',
    'history-tenant-test',
    '11000000-0000-4000-8000-000000000601',
    '11000000-0000-4000-8000-000000000601',
    '11000000-0000-4000-8000-000000000601'
  ),
  (
    '21000000-0000-4000-8000-000000000602',
    'History Other Tenant',
    'history-other-tenant-test',
    '11000000-0000-4000-8000-000000000604',
    '11000000-0000-4000-8000-000000000604',
    '11000000-0000-4000-8000-000000000604'
  );

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  ('21000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601', 'owner', 'active',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  ('21000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000602', 'planner', 'active',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  ('21000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000603', 'viewer', 'active',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  ('21000000-0000-4000-8000-000000000602', '11000000-0000-4000-8000-000000000604', 'owner', 'active',
   '11000000-0000-4000-8000-000000000604', '11000000-0000-4000-8000-000000000604');

insert into app.people (
  id, organization_id, user_id, initials, name, role_title, department,
  location, created_by, updated_by
) values
  ('61000000-0000-4000-8000-000000000601', '21000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000602',
   'HP', 'History Planner', 'Engineer', 'Unit A', 'Tokyo',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  ('61000000-0000-4000-8000-000000000602', '21000000-0000-4000-8000-000000000601', null,
   'HM', 'History Member', 'Engineer', 'Unit A', 'Tokyo',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  ('61000000-0000-4000-8000-000000000603', '21000000-0000-4000-8000-000000000601', null,
   'HO', 'History Outsider', 'Engineer', 'Unit B', 'Tokyo',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  ('61000000-0000-4000-8000-000000000604', '21000000-0000-4000-8000-000000000601', null,
   'HL', 'History Leaver', 'Engineer', 'Unit A', 'Tokyo',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601');

update app.people set is_active = false where id = '61000000-0000-4000-8000-000000000604';

insert into app.org_units (id, organization_id, name, created_by, updated_by) values
  ('65000000-0000-4000-8000-000000000601', '21000000-0000-4000-8000-000000000601', 'Unit A',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  ('65000000-0000-4000-8000-000000000602', '21000000-0000-4000-8000-000000000601', 'Unit B',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601');

insert into app.person_org_units (organization_id, person_id, org_unit_id, is_primary) values
  ('21000000-0000-4000-8000-000000000601', '61000000-0000-4000-8000-000000000601', '65000000-0000-4000-8000-000000000601', true),
  ('21000000-0000-4000-8000-000000000601', '61000000-0000-4000-8000-000000000602', '65000000-0000-4000-8000-000000000601', true),
  ('21000000-0000-4000-8000-000000000601', '61000000-0000-4000-8000-000000000603', '65000000-0000-4000-8000-000000000602', true);

-- The planner sees only its own unit. The viewer has no row, so it sees everyone.
insert into app.role_permissions (
  organization_id, role, person_scope, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000601', 'planner', 'unit',
  '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'
);

insert into app.projects (
  id, organization_id, code, name, status, tone,
  start_date, end_date, progress_percent, demand_headcount, created_by, updated_by
) values
  ('62000000-0000-4000-8000-000000000601', '21000000-0000-4000-8000-000000000601',
   'HIST', 'History Project', '進行中', 'blue',
   current_date - 120, current_date + 60, 10, 1,
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  ('62000000-0000-4000-8000-000000000602', '21000000-0000-4000-8000-000000000601',
   'GONE', 'Archived Project', '完了', 'mint',
   current_date - 200, current_date - 100, 100, 1,
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601');

insert into app.assignments (
  id, organization_id, person_id, project_id, start_date, end_date,
  allocation_percent, status, created_by, updated_by
) values
  -- current, to be cancelled through save_workspace
  ('64000000-0000-4000-8000-000000000601', '21000000-0000-4000-8000-000000000601',
   '61000000-0000-4000-8000-000000000602', '62000000-0000-4000-8000-000000000601',
   current_date, current_date + 30, 50, 'confirmed',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  -- ended, stays confirmed
  ('64000000-0000-4000-8000-000000000602', '21000000-0000-4000-8000-000000000601',
   '61000000-0000-4000-8000-000000000602', '62000000-0000-4000-8000-000000000601',
   current_date - 100, current_date - 40, 30, 'confirmed',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601'),
  -- the outsider's, for the scope check
  ('64000000-0000-4000-8000-000000000604', '21000000-0000-4000-8000-000000000601',
   '61000000-0000-4000-8000-000000000603', '62000000-0000-4000-8000-000000000601',
   current_date, current_date + 10, 20, 'confirmed',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601');

-- A cancellation that happened before this migration: no stamp.
alter table app.assignments disable trigger assignments_cancellation_stamp;
insert into app.assignments (
  id, organization_id, person_id, project_id, start_date, end_date,
  allocation_percent, status, created_by, updated_by
) values
  ('64000000-0000-4000-8000-000000000603', '21000000-0000-4000-8000-000000000601',
   '61000000-0000-4000-8000-000000000602', '62000000-0000-4000-8000-000000000602',
   current_date - 190, current_date - 110, 40, 'cancelled',
   '11000000-0000-4000-8000-000000000601', '11000000-0000-4000-8000-000000000601');
alter table app.assignments enable trigger assignments_cancellation_stamp;

update app.projects
set status = 'アーカイブ', archived_at = now()
where id = '62000000-0000-4000-8000-000000000602';

select has_function(
  'public',
  'list_assignment_history',
  array['uuid', 'uuid'],
  'the history RPC exists'
);

select ok(
  has_function_privilege('authenticated', 'public.list_assignment_history(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_assignment_history(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.list_assignment_history(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.stamp_assignment_cancellation()', 'EXECUTE'),
  'only authenticated may read the history; nothing wraps it for the service role'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000601';

select public.save_workspace(
  '21000000-0000-4000-8000-000000000601',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000601'),
  gen_random_uuid(),
  jsonb_build_object('assignments', jsonb_build_object(
    'upsert', '[]'::jsonb,
    'cancelIds', jsonb_build_array('64000000-0000-4000-8000-000000000601')
  )),
  repeat('0', 64)
);

reset role;

select ok(
  (
    select cancelled_at is not null
      and cancelled_by = '11000000-0000-4000-8000-000000000601'
    from app.assignments
    where id = '64000000-0000-4000-8000-000000000601'
  ),
  'cancelling through save_workspace stamps when and by whom'
);

select ok(
  (
    select cancelled_at is null and cancelled_by is null
    from app.assignments
    where id = '64000000-0000-4000-8000-000000000602'
  ),
  'an assignment that is not cancelled has no stamp'
);

create temp table hist_stamp on commit drop as
select cancelled_at, cancelled_by
from app.assignments
where id = '64000000-0000-4000-8000-000000000601';

update app.assignments
set label = '後から付けたラベル', updated_by = '11000000-0000-4000-8000-000000000602'
where id = '64000000-0000-4000-8000-000000000601';

select ok(
  (
    select assignment.cancelled_at = stamp.cancelled_at
      and assignment.cancelled_by = stamp.cancelled_by
    from app.assignments as assignment, hist_stamp as stamp
    where assignment.id = '64000000-0000-4000-8000-000000000601'
  ),
  'a later update of a cancelled row does not move its stamp'
);

select ok(
  (
    select cancelled_at is null and cancelled_by is null
    from app.assignments
    where id = '64000000-0000-4000-8000-000000000603'
  ),
  'a row cancelled before the migration keeps no stamp'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000601';

select is(
  (
    select array_agg(item ->> 'id' order by ordinality)
    from jsonb_array_elements(
      public.list_assignment_history(
        '21000000-0000-4000-8000-000000000601',
        '61000000-0000-4000-8000-000000000602'
      ) -> 'items'
    ) with ordinality as entry(item, ordinality)
  ),
  array[
    '64000000-0000-4000-8000-000000000601',
    '64000000-0000-4000-8000-000000000602',
    '64000000-0000-4000-8000-000000000603'
  ],
  'owner reads every assignment of the person, cancelled included, newest start first'
);

select ok(
  (
    select item ->> 'status' = 'cancelled'
      and item ->> 'cancelledAt' is not null
      and item ->> 'cancelledByName' = '履歴 Owner'
      and item ->> 'projectName' = 'History Project'
      and (item ->> 'projectArchived')::boolean = false
      and (item ->> 'allocation')::numeric = 50
    from jsonb_array_elements(
      public.list_assignment_history(
        '21000000-0000-4000-8000-000000000601',
        '61000000-0000-4000-8000-000000000602'
      ) -> 'items'
    ) as item
    where item ->> 'id' = '64000000-0000-4000-8000-000000000601'
  ),
  'a new cancellation carries when, who, and the project'
);

select ok(
  (
    select item ->> 'status' = 'cancelled'
      and item -> 'cancelledAt' = 'null'::jsonb
      and item -> 'cancelledByName' = 'null'::jsonb
      and item ->> 'projectName' = 'Archived Project'
      and (item ->> 'projectArchived')::boolean
    from jsonb_array_elements(
      public.list_assignment_history(
        '21000000-0000-4000-8000-000000000601',
        '61000000-0000-4000-8000-000000000602'
      ) -> 'items'
    ) as item
    where item ->> 'id' = '64000000-0000-4000-8000-000000000603'
  ),
  'an older cancellation on an archived project says so and invents no time'
);

select throws_ok(
  $$select public.list_assignment_history(
      '21000000-0000-4000-8000-000000000601',
      '61000000-0000-4000-8000-0000000006ff'
    )$$,
  '42501',
  'not authorized',
  'a person who does not exist is refused like one out of scope'
);

select throws_ok(
  $$select public.list_assignment_history(
      '21000000-0000-4000-8000-000000000601',
      '61000000-0000-4000-8000-000000000604'
    )$$,
  '42501',
  'not authorized',
  'an archived member is outside the readable people'
);

select throws_ok(
  $$select public.list_assignment_history('21000000-0000-4000-8000-000000000601', null)$$,
  '22023',
  'organization and person are required',
  'a missing person is rejected'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000603';

select is(
  jsonb_array_length(public.list_assignment_history(
    '21000000-0000-4000-8000-000000000601',
    '61000000-0000-4000-8000-000000000602'
  ) -> 'items'),
  3,
  'a viewer reads the history of a person it can see in the snapshot'
);

select is(
  jsonb_array_length(public.list_assignment_history(
    '21000000-0000-4000-8000-000000000601',
    '61000000-0000-4000-8000-000000000603'
  ) -> 'items'),
  1,
  'an organization-scoped viewer also reads another unit'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000602';

select is(
  jsonb_array_length(public.list_assignment_history(
    '21000000-0000-4000-8000-000000000601',
    '61000000-0000-4000-8000-000000000602'
  ) -> 'items'),
  3,
  'a unit-scoped planner reads a person in its unit'
);

select throws_ok(
  $$select public.list_assignment_history(
      '21000000-0000-4000-8000-000000000601',
      '61000000-0000-4000-8000-000000000603'
    )$$,
  '42501',
  'not authorized',
  'a unit-scoped planner cannot read a person outside its unit'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000604';

select throws_ok(
  $$select public.list_assignment_history(
      '21000000-0000-4000-8000-000000000601',
      '61000000-0000-4000-8000-000000000602'
    )$$,
  '42501',
  'not authorized',
  'another organization''s owner cannot read the history'
);

reset role;

update app.assignments
set status = 'confirmed', updated_by = '11000000-0000-4000-8000-000000000601'
where id = '64000000-0000-4000-8000-000000000601';

select ok(
  (
    select cancelled_at is null and cancelled_by is null
    from app.assignments
    where id = '64000000-0000-4000-8000-000000000601'
  ),
  'leaving cancelled clears the stamp'
);

set local role anon;

select throws_ok(
  $$select public.list_assignment_history(
      '21000000-0000-4000-8000-000000000601',
      '61000000-0000-4000-8000-000000000602'
    )$$,
  '42501',
  null,
  'anon cannot call the history RPC'
);

reset role;

select * from finish();
rollback;
