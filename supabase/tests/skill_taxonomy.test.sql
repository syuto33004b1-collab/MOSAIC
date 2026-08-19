begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000001', 'skill-owner@test.local', '{"full_name":"Skill Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000001',
  'Skill Tenant',
  'skill-tenant-test',
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001'
);

insert into app.people (
  id, organization_id, initials, name, role_title, department, avatar_tone,
  location, capacity_percent, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000009',
  '21000000-0000-4000-8000-000000000001',
  'SK',
  'Skill Person',
  'Engineer',
  'Platform',
  'mint',
  'Tokyo',
  100,
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001'
);

insert into app.skills (id, organization_id, name, kind, created_by, updated_by) values
  (
    '31000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'Engineering',
    'category',
    '11000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001'
  ),
  (
    '31000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    'PostgreSQL',
    'skill',
    '11000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001'
  );

update app.skills
set parent_id = '31000000-0000-4000-8000-000000000001'
where id = '31000000-0000-4000-8000-000000000002';

insert into app.person_skills (
  organization_id, person_id, skill_id, proficiency, created_by
) values (
  '21000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000009',
  '31000000-0000-4000-8000-000000000002',
  5,
  '11000000-0000-4000-8000-000000000001'
);

select is(
  (select kind from app.skills where id = '31000000-0000-4000-8000-000000000001'),
  'category',
  'skill catalog stores categories'
);

select throws_ok(
  $$update app.skills
    set parent_id = '31000000-0000-4000-8000-000000000002'
    where id = '31000000-0000-4000-8000-000000000001'$$,
  '23514',
  'skill parent must be a category',
  'categories cannot parent under a leaf skill'
);

select throws_ok(
  $$insert into app.person_skills (
      organization_id, person_id, skill_id, created_by
    ) values (
      '21000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000009',
      '31000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  'categories cannot be assigned as skills',
  'person skills reject categories'
);

select is(
  (select proficiency from app.person_skills
    where person_id = '61000000-0000-4000-8000-000000000009'),
  5::smallint,
  'person skills persist proficiency'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000001';

select ok(
  (select jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000001') -> 'skillCatalog') >= 2),
  'get_workspace includes the skill catalog'
);

select is(
  (
    select item -> 'skillLevels' -> 0 ->> 'proficiency'
    from jsonb_array_elements(public.get_workspace('21000000-0000-4000-8000-000000000001') -> 'members') as item
    where item ->> 'name' = 'Skill Person'
  ),
  '5',
  'get_workspace returns member skill proficiency'
);

reset role;

select has_function(
  'private',
  'apply_skill_catalog',
  array['uuid', 'jsonb', 'uuid'],
  'skill catalog apply helper exists'
);

select * from finish();
rollback;
