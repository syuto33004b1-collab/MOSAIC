begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

-- Period-specific weekday ceilings nested on members (#323).
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000092', 'leave-owner@test.local', '{"full_name":"Leave Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000092',
  'Leave Tenant',
  'leave-tenant-test',
  '11000000-0000-4000-8000-000000000092',
  '11000000-0000-4000-8000-000000000092',
  '11000000-0000-4000-8000-000000000092'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000092',
  '11000000-0000-4000-8000-000000000092',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000092',
  '11000000-0000-4000-8000-000000000092'
);

insert into app.people (
  id, organization_id, initials, name, role_title, department, avatar_tone,
  location, capacity_percent, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000092',
  '21000000-0000-4000-8000-000000000092',
  'LP',
  'Leave Person',
  'QA Engineer',
  'QA',
  'mint',
  'Tokyo',
  80,
  '11000000-0000-4000-8000-000000000092',
  '11000000-0000-4000-8000-000000000092'
);

select has_table('app', 'person_unavailability', 'the unavailability table exists');

select has_function(
  'private',
  'apply_person_unavailability',
  array['uuid', 'jsonb', 'uuid'],
  'the unavailability apply helper exists'
);

select throws_ok(
  $$insert into app.person_unavailability (
      id, organization_id, person_id, start_date, end_date, capacity_percent
    ) values (
      '91000000-0000-4000-8000-000000000092',
      '21000000-0000-4000-8000-000000000092',
      '61000000-0000-4000-8000-000000000092',
      '2026-08-21',
      '2026-08-17',
      50
    )$$,
  '23514',
  'new row for relation "person_unavailability" violates check constraint "person_unavailability_ordered"',
  'the end cannot precede the start'
);

select throws_ok(
  $$insert into app.person_unavailability (
      organization_id, person_id, start_date, end_date, capacity_percent
    ) values (
      '21000000-0000-4000-8000-000000000092',
      '61000000-0000-4000-8000-000000000092',
      '2026-08-17',
      '2026-08-21',
      120
    )$$,
  '23514',
  'new row for relation "person_unavailability" violates check constraint "person_unavailability_capacity_percent_check"',
  'the ceiling is 0–100'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000092';

select is(
  (
    select item -> 'unavailability'
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000092') -> 'members'
    ) as item
    where item ->> 'id' = '61000000-0000-4000-8000-000000000092'
  ),
  '[]'::jsonb,
  'get_workspace returns an empty unavailability array when there are no rows'
);

select public.save_workspace(
  '21000000-0000-4000-8000-000000000092',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000092'),
  gen_random_uuid(),
  jsonb_build_object('members', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object(
      'id', '61000000-0000-4000-8000-000000000092',
      'initials', 'LP',
      'name', 'Leave Person',
      'role', 'QA Engineer',
      'department', 'QA',
      'location', 'Tokyo',
      'capacity', 80,
      'unavailability', jsonb_build_array(
        jsonb_build_object(
          'id', '91000000-0000-4000-8000-000000000001',
          'startDate', '2026-08-17',
          'endDate', '2026-08-21',
          'capacityPercent', 50,
          'note', '時短'
        )
      )
    )
  ))),
  repeat('a', 64)
);

reset role;

select is(
  (
    select count(*)::int from app.person_unavailability
    where person_id = '61000000-0000-4000-8000-000000000092'
  ),
  1,
  'a payload with the key writes the rows'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000092';

select is(
  (
    select item -> 'unavailability'
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000092') -> 'members'
    ) as item
    where item ->> 'id' = '61000000-0000-4000-8000-000000000092'
  ),
  jsonb_build_array(jsonb_build_object(
    'id', '91000000-0000-4000-8000-000000000001',
    'startDate', '2026-08-17',
    'endDate', '2026-08-21',
    'capacityPercent', 50,
    'note', '時短'
  )),
  'get_workspace nests unavailability on the member'
);

-- Key absent leaves the rows. Same three-valued contract as weekendWorkDates.
select public.save_workspace(
  '21000000-0000-4000-8000-000000000092',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000092'),
  gen_random_uuid(),
  jsonb_build_object('members', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object(
      'id', '61000000-0000-4000-8000-000000000092',
      'initials', 'LP',
      'name', 'Leave Person',
      'role', 'QA Engineer',
      'department', 'QA',
      'location', 'Tokyo',
      'capacity', 80
    )
  ))),
  repeat('b', 64)
);

reset role;

select is(
  (select count(*)::int from app.person_unavailability
    where person_id = '61000000-0000-4000-8000-000000000092'),
  1,
  'a payload without the key leaves the rows alone'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000092';

select public.save_workspace(
  '21000000-0000-4000-8000-000000000092',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000092'),
  gen_random_uuid(),
  jsonb_build_object('members', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object(
      'id', '61000000-0000-4000-8000-000000000092',
      'initials', 'LP',
      'name', 'Leave Person',
      'role', 'QA Engineer',
      'department', 'QA',
      'location', 'Tokyo',
      'capacity', 80,
      'unavailability', '[]'::jsonb
    )
  ))),
  repeat('c', 64)
);

reset role;

select is(
  (select count(*)::int from app.person_unavailability
    where person_id = '61000000-0000-4000-8000-000000000092'),
  0,
  'an empty array clears them'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000092';

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000092',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000092'),
      gen_random_uuid(),
      jsonb_build_object('members', jsonb_build_object('upsert', jsonb_build_array(
        jsonb_build_object(
          'id', '61000000-0000-4000-8000-000000000092',
          'initials', 'LP',
          'name', 'Leave Person',
          'role', 'QA Engineer',
          'department', 'QA',
          'location', 'Tokyo',
          'capacity', 80,
          'unavailability', (
            select jsonb_agg(jsonb_build_object(
              'id', gen_random_uuid(),
              'startDate', '2026-08-17',
              'endDate', '2026-08-17',
              'capacityPercent', 0
            ))
            from generate_series(1, 51)
          )
        )
      ))),
      repeat('d', 64)
    )$$,
  '22023',
  'members.upsert[].unavailability may have at most 50 rows',
  'more than 50 rows is refused'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000092',
      (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000092'),
      gen_random_uuid(),
      jsonb_build_object('members', jsonb_build_object('upsert', jsonb_build_array(
        jsonb_build_object(
          'id', '61000000-0000-4000-8000-000000000092',
          'initials', 'LP',
          'name', 'Leave Person',
          'role', 'QA Engineer',
          'department', 'QA',
          'location', 'Tokyo',
          'capacity', 80,
          'unavailability', jsonb_build_array(jsonb_build_object(
            'id', '91000000-0000-4000-8000-000000000002',
            'startDate', '2026-08-17',
            'endDate', '2026-08-21',
            'capacityPercent', 40,
            'note', repeat('あ', 81)
          ))
        )
      ))),
      repeat('e', 64)
    )$$,
  '22023',
  'members.upsert[].unavailability note must be 80 characters or fewer',
  'a note longer than 80 characters is refused'
);

reset role;

select * from finish();
rollback;
