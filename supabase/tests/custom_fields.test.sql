begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000011', 'fields-owner@test.local', '{"full_name":"Fields Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000011',
  'Fields Tenant',
  'fields-tenant-test',
  '11000000-0000-4000-8000-000000000011',
  '11000000-0000-4000-8000-000000000011',
  '11000000-0000-4000-8000-000000000011'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000011',
  '11000000-0000-4000-8000-000000000011',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000011',
  '11000000-0000-4000-8000-000000000011'
);

insert into app.people (
  id, organization_id, initials, name, role_title, department, avatar_tone,
  location, capacity_percent, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000019',
  '21000000-0000-4000-8000-000000000011',
  'CF',
  'Custom Person',
  'Engineer',
  'Platform',
  'mint',
  'Tokyo',
  100,
  '11000000-0000-4000-8000-000000000011',
  '11000000-0000-4000-8000-000000000011'
);

insert into app.projects (
  id, organization_id, code, name, summary, status, tone, start_date, end_date,
  next_milestone, progress_percent, demand_headcount, created_by, updated_by
) values (
  '62000000-0000-4000-8000-000000000019',
  '21000000-0000-4000-8000-000000000011',
  'FLD',
  'Fields Project',
  'Custom field coverage',
  '進行中',
  'blue',
  '2026-08-01',
  '2026-12-31',
  'Review',
  10,
  2,
  '11000000-0000-4000-8000-000000000011',
  '11000000-0000-4000-8000-000000000011'
);

insert into app.custom_fields (
  id, organization_id, entity_type, field_key, label, field_type, options, show_in_list, created_by, updated_by
) values (
  '51000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000011',
  'member',
  'employment_type',
  '雇用形態',
  'select',
  '["正社員","契約"]'::jsonb,
  true,
  '11000000-0000-4000-8000-000000000011',
  '11000000-0000-4000-8000-000000000011'
);

insert into app.custom_field_values (
  organization_id, field_id, entity_id, value_text, created_by
) values (
  '21000000-0000-4000-8000-000000000011',
  '51000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000019',
  '正社員',
  '11000000-0000-4000-8000-000000000011'
);

insert into app.work_history (
  id, organization_id, person_id, title, organization_name, start_date, created_by, updated_by
) values (
  '71000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000011',
  '61000000-0000-4000-8000-000000000019',
  'Backend Engineer',
  'Fields Tenant',
  '2024-04-01',
  '11000000-0000-4000-8000-000000000011',
  '11000000-0000-4000-8000-000000000011'
);

select throws_ok(
  $$insert into app.custom_field_values (
      organization_id, field_id, entity_id, value_text, created_by
    ) values (
      '21000000-0000-4000-8000-000000000011',
      '51000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000019',
      '正社員',
      '11000000-0000-4000-8000-000000000011'
    )$$,
  '23503',
  'custom field value must reference a member in the same organization',
  'member fields cannot be stored on projects'
);

select throws_ok(
  $$update app.custom_field_values
    set value_text = '業務委託'
    where field_id = '51000000-0000-4000-8000-000000000001'$$,
  '23514',
  'custom field select values must match an option',
  'select values must match defined options'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000011';

select ok(
  (select jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000011') -> 'customFields') = 1),
  'get_workspace includes custom field definitions'
);

select is(
  (
    select item -> 'customValues' ->> '51000000-0000-4000-8000-000000000001'
    from jsonb_array_elements(public.get_workspace('21000000-0000-4000-8000-000000000011') -> 'members') as item
    where item ->> 'name' = 'Custom Person'
  ),
  '正社員',
  'get_workspace returns member custom values'
);

select is(
  (
    select item -> 'workHistory' -> 0 ->> 'organization'
    from jsonb_array_elements(public.get_workspace('21000000-0000-4000-8000-000000000011') -> 'members') as item
    where item ->> 'name' = 'Custom Person'
  ),
  'Fields Tenant',
  'get_workspace returns member work history'
);

reset role;

select has_function(
  'private',
  'apply_custom_fields',
  array['uuid', 'jsonb', 'uuid'],
  'custom field apply helper exists'
);

select has_function(
  'private',
  'apply_work_history',
  array['uuid', 'jsonb', 'uuid'],
  'work history apply helper exists'
);

select has_table('app', 'custom_fields', 'custom fields table exists');

select * from finish();
rollback;
