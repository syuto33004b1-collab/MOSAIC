begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000018', 'org-owner@test.local', '{"full_name":"Org Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000018',
  'Org Tenant',
  'org-tenant-test',
  '11000000-0000-4000-8000-000000000018',
  '11000000-0000-4000-8000-000000000018',
  '11000000-0000-4000-8000-000000000018'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000018',
  '11000000-0000-4000-8000-000000000018',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000018',
  '11000000-0000-4000-8000-000000000018'
);

insert into app.people (
  id, organization_id, initials, name, role_title, department, avatar_tone,
  location, capacity_percent, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000018',
  '21000000-0000-4000-8000-000000000018',
  'OG',
  'Org Person',
  'Engineer',
  'Platform',
  'mint',
  'Tokyo',
  100,
  '11000000-0000-4000-8000-000000000018',
  '11000000-0000-4000-8000-000000000018'
);

insert into app.org_units (id, organization_id, name, sort_order, created_by, updated_by) values
  ('81000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000018', '開発本部', 10, '11000000-0000-4000-8000-000000000018', '11000000-0000-4000-8000-000000000018'),
  ('81000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000018', 'プロダクト開発', 10, '11000000-0000-4000-8000-000000000018', '11000000-0000-4000-8000-000000000018');

update app.org_units
set parent_id = '81000000-0000-4000-8000-000000000001'
where id = '81000000-0000-4000-8000-000000000002';

insert into app.person_org_units (
  id, organization_id, person_id, org_unit_id, is_primary, is_manager, created_by
) values (
  '91000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000018',
  '61000000-0000-4000-8000-000000000018',
  '81000000-0000-4000-8000-000000000002',
  true,
  true,
  '11000000-0000-4000-8000-000000000018'
);

select throws_ok(
  $$update app.org_units
    set parent_id = '81000000-0000-4000-8000-000000000002'
    where id = '81000000-0000-4000-8000-000000000001'$$,
  '23514',
  'organization unit cannot contain a cycle',
  'parent cannot move under a descendant'
);

select throws_ok(
  $$insert into app.org_units (
      organization_id, name, created_by, updated_by
    ) values (
      '21000000-0000-4000-8000-000000000018',
      'プロダクト開発',
      '11000000-0000-4000-8000-000000000018',
      '11000000-0000-4000-8000-000000000018'
    )$$,
  '23505',
  NULL,
  'org unit names are unique in an organization'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000018';

select ok(
  (select jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000018') -> 'orgUnits') = 2),
  'get_workspace includes organization units'
);

select is(
  (
    select item ->> 'orgUnitId'
    from jsonb_array_elements(public.get_workspace('21000000-0000-4000-8000-000000000018') -> 'orgMemberships') as item
    where item ->> 'personId' = '61000000-0000-4000-8000-000000000018'
  ),
  '81000000-0000-4000-8000-000000000002',
  'get_workspace returns member organization memberships'
);

reset role;

select private.sync_people_departments_from_org(
  '21000000-0000-4000-8000-000000000018',
  '11000000-0000-4000-8000-000000000018'
);

select is(
  (select department from app.people where id = '61000000-0000-4000-8000-000000000018'),
  'プロダクト開発',
  'primary org unit name syncs to people.department'
);

select has_table('app', 'org_units', 'org units table exists');
select has_table('app', 'person_org_units', 'person org units table exists');
select has_function(
  'private',
  'apply_org_units',
  array['uuid', 'jsonb', 'uuid'],
  'org unit apply helper exists'
);

select * from finish();
rollback;
