begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000031', 'reports-owner@test.local', '{"full_name":"Reports Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000031',
  'Reports Tenant',
  'reports-tenant-test',
  '11000000-0000-4000-8000-000000000031',
  '11000000-0000-4000-8000-000000000031',
  '11000000-0000-4000-8000-000000000031'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000031',
  '11000000-0000-4000-8000-000000000031',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000031',
  '11000000-0000-4000-8000-000000000031'
);

insert into app.saved_reports (
  id, organization_id, name, source, group_by, metric, created_by, updated_by
) values (
  '51000000-0000-4000-8000-000000000031',
  '21000000-0000-4000-8000-000000000031',
  '部署別人数',
  'members',
  'department',
  'count',
  '11000000-0000-4000-8000-000000000031',
  '11000000-0000-4000-8000-000000000031'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000031';

select ok(
  (select jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000031') -> 'savedReports') = 1),
  'get_workspace includes saved reports'
);

select is(
  (
    select item ->> 'groupBy'
    from jsonb_array_elements(public.get_workspace('21000000-0000-4000-8000-000000000031') -> 'savedReports') as item
    where item ->> 'name' = '部署別人数'
  ),
  'department',
  'get_workspace returns saved report groupBy'
);

reset role;

select has_function(
  'private',
  'apply_saved_reports',
  array['uuid', 'jsonb', 'uuid'],
  'saved report apply helper exists'
);

select has_table('app', 'saved_reports', 'saved reports table exists');

select throws_ok(
  $$insert into app.saved_reports (
      id, organization_id, name, source, group_by, metric, created_by, updated_by
    ) values (
      '51000000-0000-4000-8000-000000000032',
      '21000000-0000-4000-8000-000000000031',
      '不正グループ',
      'projects',
      'department',
      'count',
      '11000000-0000-4000-8000-000000000031',
      '11000000-0000-4000-8000-000000000031'
    )$$,
  '23514',
  'new row for relation "saved_reports" violates check constraint "saved_reports_grouping_check"',
  'project reports may only group by status'
);

select * from finish();
rollback;
