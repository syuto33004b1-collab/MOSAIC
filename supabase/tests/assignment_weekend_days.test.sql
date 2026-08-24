begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

-- Weekend work, recorded as the days it happened on (#222).
--
-- The board grew Saturday and Sunday columns in #207 without changing a figure,
-- because an assignment carries a date range and no working days: 12 of the 15 in
-- the seed span a weekend simply by lasting more than a week. These rows are how
-- a weekend becomes a fact rather than a side effect of the range.
select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000091', 'weekend-owner@test.local', '{"full_name":"Weekend Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000091',
  'Weekend Tenant',
  'weekend-tenant-test',
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

insert into app.people (
  id, organization_id, initials, name, role_title, department, avatar_tone,
  location, capacity_percent, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000091',
  '21000000-0000-4000-8000-000000000091',
  'WP',
  'Weekend Person',
  'QA Engineer',
  'QA',
  'mint',
  'Tokyo',
  100,
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

insert into app.projects (
  id, organization_id, code, name, summary, status, tone, start_date, end_date,
  next_milestone, progress_percent, demand_headcount, created_by, updated_by
) values (
  '71000000-0000-4000-8000-000000000091',
  '21000000-0000-4000-8000-000000000091',
  'WK',
  '週末対応',
  '休日当番',
  '進行中',
  'blue',
  '2026-08-17',
  '2026-09-30',
  'リリース',
  10,
  1,
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

-- 2026-08-17 is a Monday; 8/22 and 8/23 are its Saturday and Sunday.
insert into app.assignments (
  id, organization_id, person_id, project_id, start_date, end_date,
  allocation_percent, status, created_by, updated_by
) values (
  '81000000-0000-4000-8000-000000000091',
  '21000000-0000-4000-8000-000000000091',
  '61000000-0000-4000-8000-000000000091',
  '71000000-0000-4000-8000-000000000091',
  '2026-08-17',
  '2026-08-28',
  60,
  'confirmed',
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

select has_table('app', 'assignment_weekend_days', 'the weekend day table exists');

select has_function(
  'private',
  'apply_assignment_weekend_days',
  array['uuid', 'jsonb', 'uuid'],
  'the weekend day apply helper exists'
);

-- A weekday cannot be a weekend day. The table is named for the weekend and the
-- whole contract reads that way; a Tuesday in here would make it mean something
-- else. A public holiday moves the weekday ceiling too and belongs elsewhere.
select throws_ok(
  $$insert into app.assignment_weekend_days (organization_id, assignment_id, work_date, created_by)
    values (
      '21000000-0000-4000-8000-000000000091',
      '81000000-0000-4000-8000-000000000091',
      '2026-08-18',
      '11000000-0000-4000-8000-000000000091'
    )$$,
  '23514',
  'new row for relation "assignment_weekend_days" violates check constraint "assignment_weekend_days_weekend_only"',
  'a Tuesday is not a weekend day'
);

-- Outside the parent's range is not a fact about anything. 2026-09-05 is a
-- Saturday, and this assignment ends on 8/28.
select throws_ok(
  $$insert into app.assignment_weekend_days (organization_id, assignment_id, work_date, created_by)
    values (
      '21000000-0000-4000-8000-000000000091',
      '81000000-0000-4000-8000-000000000091',
      '2026-09-05',
      '11000000-0000-4000-8000-000000000091'
    )$$,
  '22023',
  'weekend day 2026-09-05 is outside the assignment 2026-08-17..2026-08-28',
  'a weekend day outside the assignment is refused'
);

insert into app.assignment_weekend_days (organization_id, assignment_id, work_date, created_by)
values
  ('21000000-0000-4000-8000-000000000091', '81000000-0000-4000-8000-000000000091', '2026-08-22', '11000000-0000-4000-8000-000000000091'),
  ('21000000-0000-4000-8000-000000000091', '81000000-0000-4000-8000-000000000091', '2026-08-23', '11000000-0000-4000-8000-000000000091');

select is(
  (select count(*)::int from app.assignment_weekend_days
    where assignment_id = '81000000-0000-4000-8000-000000000091'),
  2,
  'two weekend days are recorded'
);

-- Shortening the assignment drops the days it no longer covers. Without this they
-- survive out of range and come back the moment the range is widened again.
update app.assignments
set end_date = '2026-08-21', updated_by = '11000000-0000-4000-8000-000000000091'
where id = '81000000-0000-4000-8000-000000000091';

select is(
  (select count(*)::int from app.assignment_weekend_days
    where assignment_id = '81000000-0000-4000-8000-000000000091'),
  0,
  'shortening the assignment prunes the weekend days outside it'
);

-- And widening it again does not bring them back.
update app.assignments
set end_date = '2026-08-28', updated_by = '11000000-0000-4000-8000-000000000091'
where id = '81000000-0000-4000-8000-000000000091';

select is(
  (select count(*)::int from app.assignment_weekend_days
    where assignment_id = '81000000-0000-4000-8000-000000000091'),
  0,
  'widening it again leaves them gone'
);

-- Deleting the assignment takes its weekend days with it.
insert into app.assignment_weekend_days (organization_id, assignment_id, work_date, created_by)
values ('21000000-0000-4000-8000-000000000091', '81000000-0000-4000-8000-000000000091', '2026-08-22', '11000000-0000-4000-8000-000000000091');

select is(
  (select count(*)::int from app.assignment_weekend_days
    where assignment_id = '81000000-0000-4000-8000-000000000091'),
  1,
  'one weekend day is back'
);

-- The audit trail knows what the row was about.
select is(
  (
    select event.entity_key ->> 'workDate'
    from app.audit_events as event
    where event.entity_type = 'assignment_weekend_days'
      and event.entity_key ->> 'assignmentId' = '81000000-0000-4000-8000-000000000091'
    order by event.occurred_at desc, event.id desc
    limit 1
  ),
  '2026-08-22',
  'the audit event carries the day, not just the assignment'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000091';

select is(
  (
    select item -> 'weekendWorkDates'
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'assignments'
    ) as item
    where item ->> 'id' = '81000000-0000-4000-8000-000000000091'
  ),
  '["2026-08-22"]'::jsonb,
  'get_workspace returns the weekend days as calendar dates'
);

/*
 * The three-valued contract for the whole-workspace save, which is the part that
 * needed deciding. A client that has not learned the field — the external API, an
 * MCP write — sends every assignment back without it, and 「absent means clear」
 * would delete a person's weekend work as a side effect of an unrelated edit.
 */
select public.save_workspace(
  '21000000-0000-4000-8000-000000000091',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000091'),
  gen_random_uuid(),
  jsonb_build_object('assignments', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object(
      'id', '81000000-0000-4000-8000-000000000091',
      'personId', '61000000-0000-4000-8000-000000000091',
      'projectId', '71000000-0000-4000-8000-000000000091',
      'startDate', '2026-08-17',
      'endDate', '2026-08-28',
      'allocation', 70,
      'status', 'confirmed'
    )
  ))),
  repeat('a', 64)
);

reset role;

select is(
  (select count(*)::int from app.assignment_weekend_days
    where assignment_id = '81000000-0000-4000-8000-000000000091'),
  1,
  'a payload without the key leaves the weekend days alone'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000091';

select public.save_workspace(
  '21000000-0000-4000-8000-000000000091',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000091'),
  gen_random_uuid(),
  jsonb_build_object('assignments', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object(
      'id', '81000000-0000-4000-8000-000000000091',
      'personId', '61000000-0000-4000-8000-000000000091',
      'projectId', '71000000-0000-4000-8000-000000000091',
      'startDate', '2026-08-17',
      'endDate', '2026-08-28',
      'allocation', 70,
      'status', 'confirmed',
      'weekendWorkDates', jsonb_build_array('2026-08-23')
    )
  ))),
  repeat('b', 64)
);

reset role;

select is(
  (select array_agg(work_date::text order by work_date) from app.assignment_weekend_days
    where assignment_id = '81000000-0000-4000-8000-000000000091'),
  array['2026-08-23'],
  'a payload with the key replaces the set: 8/22 out, 8/23 in'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000091';

select public.save_workspace(
  '21000000-0000-4000-8000-000000000091',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000091'),
  gen_random_uuid(),
  jsonb_build_object('assignments', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object(
      'id', '81000000-0000-4000-8000-000000000091',
      'personId', '61000000-0000-4000-8000-000000000091',
      'projectId', '71000000-0000-4000-8000-000000000091',
      'startDate', '2026-08-17',
      'endDate', '2026-08-28',
      'allocation', 70,
      'status', 'confirmed',
      'weekendWorkDates', '[]'::jsonb
    )
  ))),
  repeat('c', 64)
);

reset role;

select is(
  (select count(*)::int from app.assignment_weekend_days
    where assignment_id = '81000000-0000-4000-8000-000000000091'),
  0,
  'an empty array clears them, which is how you say none'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000091';

-- And a null is neither of those, so it is an error rather than a guess.
select throws_ok(
  format(
    $$select public.save_workspace(
        '21000000-0000-4000-8000-000000000091',
        %s,
        gen_random_uuid(),
        jsonb_build_object('assignments', jsonb_build_object('upsert', jsonb_build_array(
          jsonb_build_object(
            'id', '81000000-0000-4000-8000-000000000091',
            'personId', '61000000-0000-4000-8000-000000000091',
            'projectId', '71000000-0000-4000-8000-000000000091',
            'startDate', '2026-08-17',
            'endDate', '2026-08-28',
            'allocation', 70,
            'status', 'confirmed',
            'weekendWorkDates', 'null'::jsonb
          )
        ))),
        repeat('d', 64)
      )$$,
    (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000091')
  ),
  '22023',
  'assignments.upsert[].weekendWorkDates must be an array of YYYY-MM-DD strings',
  'an explicit null is refused rather than read as either'
);

reset role;

select * from finish();
rollback;
