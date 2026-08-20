begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(18);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000091', 'perm-owner@test.local', '{"full_name":"Perm Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000092', 'perm-admin@test.local', '{"full_name":"Perm Admin"}'::jsonb),
  ('11000000-0000-4000-8000-000000000093', 'perm-planner@test.local', '{"full_name":"Perm Planner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000094', 'perm-viewer@test.local', '{"full_name":"Perm Viewer"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000091',
  'Permissions Tenant',
  'permissions-tenant-test',
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  ('21000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091', 'owner', 'active',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091'),
  ('21000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000092', 'admin', 'active',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091'),
  ('21000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000093', 'planner', 'active',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091'),
  ('21000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000094', 'viewer', 'active',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091');

-- Planner owns person 0001. Person 0002 shares its unit, person 0003 sits in a child unit.
insert into app.people (
  id, organization_id, user_id, initials, name, role_title, department, location, created_by, updated_by
) values
  ('31000000-0000-4000-8000-000000000091', '21000000-0000-4000-8000-000000000091',
   '11000000-0000-4000-8000-000000000093', 'PP', '計画 太郎', 'Planner', '第一本部', '東京',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091'),
  ('31000000-0000-4000-8000-000000000092', '21000000-0000-4000-8000-000000000091',
   null, 'SU', '同僚 花子', 'Engineer', '第一本部', '東京',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091'),
  ('31000000-0000-4000-8000-000000000093', '21000000-0000-4000-8000-000000000091',
   null, 'CH', '子部門 次郎', 'Engineer', '第一本部 開発課', '東京',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091');

insert into app.org_units (
  id, organization_id, name, parent_id, created_by, updated_by
) values
  ('41000000-0000-4000-8000-000000000091', '21000000-0000-4000-8000-000000000091', '第一本部', null,
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091'),
  ('41000000-0000-4000-8000-000000000092', '21000000-0000-4000-8000-000000000091', '第一本部 開発課',
   '41000000-0000-4000-8000-000000000091',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091');

insert into app.person_org_units (
  organization_id, person_id, org_unit_id, is_primary, created_by
) values
  ('21000000-0000-4000-8000-000000000091', '31000000-0000-4000-8000-000000000091',
   '41000000-0000-4000-8000-000000000091', true, '11000000-0000-4000-8000-000000000091'),
  ('21000000-0000-4000-8000-000000000091', '31000000-0000-4000-8000-000000000092',
   '41000000-0000-4000-8000-000000000091', true, '11000000-0000-4000-8000-000000000091'),
  ('21000000-0000-4000-8000-000000000091', '31000000-0000-4000-8000-000000000093',
   '41000000-0000-4000-8000-000000000092', true, '11000000-0000-4000-8000-000000000091');

insert into app.custom_fields (
  id, organization_id, entity_type, field_key, label, field_type, created_by, updated_by
) values
  ('51000000-0000-4000-8000-000000000091', '21000000-0000-4000-8000-000000000091', 'member',
   'salary_band', '給与レンジ', 'text',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091'),
  ('51000000-0000-4000-8000-000000000092', '21000000-0000-4000-8000-000000000091', 'member',
   'hr_note', '人事メモ', 'text',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091');

insert into app.custom_field_values (
  organization_id, field_id, entity_id, value_text, created_by
) values (
  '21000000-0000-4000-8000-000000000091',
  '51000000-0000-4000-8000-000000000091',
  '31000000-0000-4000-8000-000000000091',
  'B',
  '11000000-0000-4000-8000-000000000091'
);

insert into app.projects (
  id, organization_id, code, name, status, owner_person_id, start_date, end_date, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000091',
  '21000000-0000-4000-8000-000000000091',
  'PERM1',
  '権限検証プロジェクト',
  '進行中',
  '31000000-0000-4000-8000-000000000092',
  '2026-04-01',
  '2026-09-30',
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

insert into app.assignments (
  id, organization_id, person_id, project_id, start_date, end_date, allocation_percent, status, created_by, updated_by
) values
  ('71000000-0000-4000-8000-000000000091', '21000000-0000-4000-8000-000000000091',
   '31000000-0000-4000-8000-000000000091', '61000000-0000-4000-8000-000000000091',
   '2026-04-01', '2026-06-30', 50, 'draft',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091'),
  ('71000000-0000-4000-8000-000000000092', '21000000-0000-4000-8000-000000000091',
   '31000000-0000-4000-8000-000000000092', '61000000-0000-4000-8000-000000000091',
   '2026-04-01', '2026-06-30', 50, 'draft',
   '11000000-0000-4000-8000-000000000091', '11000000-0000-4000-8000-000000000091');

insert into app.search_scenes (
  id, organization_id, name, role_title, created_by, updated_by
) values (
  '81000000-0000-4000-8000-000000000091',
  '21000000-0000-4000-8000-000000000091',
  '権限検証シーン',
  'Engineer',
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

-- An unconfigured role stays unrestricted.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000091';

select is(
  public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'permissions',
  jsonb_build_object(
    'role', 'owner',
    'personScope', 'organization',
    'hiddenFieldKeys', '[]'::jsonb,
    'readonlyFieldKeys', '[]'::jsonb,
    'disabledFeatures', '[]'::jsonb
  ),
  'get_workspace reports an unrestricted owner'
);

reset role;

insert into app.role_permissions (
  organization_id, role, person_scope, hidden_field_keys, readonly_field_keys, disabled_features,
  created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000091',
  'planner',
  'self',
  array['salary_band']::text[],
  array['hr_note']::text[],
  array['searchScenes', 'favorites']::text[],
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000093';

select is(
  public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'permissions' ->> 'personScope',
  'self',
  'get_workspace reports the configured data scope'
);

select ok(
  jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'searchScenes') = 0,
  'a disabled feature section is emptied but keeps its key'
);

select ok(
  public.get_workspace('21000000-0000-4000-8000-000000000091') ? 'searchScenes',
  'a disabled feature section still returns its key'
);

select is(
  (
    select count(*)
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'customFields'
    ) as entry(field)
    where entry.field ->> 'key' = 'salary_band'
  ),
  0::bigint,
  'a hidden custom field is removed from the field catalog'
);

select is(
  (
    select entry.field ->> 'canEdit'
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'customFields'
    ) as entry(field)
    where entry.field ->> 'key' = 'hr_note'
  ),
  'false',
  'a read-only custom field is returned with canEdit false'
);

select ok(
  not (
    (
      select entry.member -> 'customValues'
      from jsonb_array_elements(
        public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'members'
      ) as entry(member)
      where entry.member ->> 'id' = '31000000-0000-4000-8000-000000000091'
    ) ? '51000000-0000-4000-8000-000000000091'
  ),
  'a hidden custom field value is removed from the member payload'
);

select is(
  jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'members'),
  1,
  'the self data scope returns only the caller''s own member row'
);

select is(
  jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'assignments'),
  1,
  'the self data scope drops assignments for people outside the scope'
);

select is(
  (
    select entry.project ->> 'ownerName'
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000091') -> 'projects'
    ) as entry(project)
    where entry.project ->> 'id' = '61000000-0000-4000-8000-000000000091'
  ),
  null,
  'a project owner outside the data scope is masked'
);

select throws_ok(
  $$select public.list_favorites('21000000-0000-4000-8000-000000000091')$$,
  '42501',
  'favorites are disabled for this role',
  'favorites are refused when the role disables them'
);

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000091',
      0,
      '91000000-0000-4000-8000-000000000091',
      '{"assignments":{"upsert":[{"id":"71000000-0000-4000-8000-000000000093","personId":"31000000-0000-4000-8000-000000000092","projectId":"61000000-0000-4000-8000-000000000091","startDate":"2026-05-01","endDate":"2026-05-31","allocation":10,"status":"draft"}],"cancelIds":[]}}'::jsonb,
      repeat('a', 64)
    )$$,
  '42501',
  'this role cannot assign a member outside its data scope',
  'a scoped role cannot assign someone it cannot see'
);

reset role;

update app.role_permissions
   set disabled_features = array['opportunities']::text[],
       person_scope = 'organization'
 where organization_id = '21000000-0000-4000-8000-000000000091'
   and role = 'planner';

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000093';

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000091',
      0,
      '91000000-0000-4000-8000-000000000092',
      '{"opportunities":{"upsert":[],"archiveIds":[]}}'::jsonb,
      repeat('b', 64)
    )$$,
  '42501',
  'pre-award opportunities are disabled for this role',
  'a disabled feature cannot be written by that role'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000092';

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000091',
      0,
      '91000000-0000-4000-8000-000000000093',
      '{"rolePermissions":{"upsert":[{"role":"admin","personScope":"self"}]}}'::jsonb,
      repeat('c', 64)
    )$$,
  '42501',
  'only owners may change administrator permissions',
  'an administrator cannot change administrator permissions'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000091';

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000091',
      0,
      '91000000-0000-4000-8000-000000000094',
      '{"rolePermissions":{"upsert":[{"role":"viewer","hiddenFieldKeys":["does_not_exist"]}]}}'::jsonb,
      repeat('d', 64)
    )$$,
  'P0002',
  'rolePermissions references an unknown custom field key',
  'an unknown custom field key is refused'
);

reset role;

insert into app.role_permissions (
  organization_id, role, hidden_field_keys, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000091',
  'admin',
  array['salary_band']::text[],
  '11000000-0000-4000-8000-000000000091',
  '11000000-0000-4000-8000-000000000091'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000092';

select throws_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000091',
      0,
      '91000000-0000-4000-8000-000000000095',
      '{"members":{"upsert":[{"id":"31000000-0000-4000-8000-000000000091","initials":"PP","name":"計画 太郎","role":"Planner","department":"第一本部","location":"東京","capacity":100,"customValues":{"51000000-0000-4000-8000-000000000091":"S"}}],"archiveIds":[]}}'::jsonb,
      repeat('e', 64)
    )$$,
  '42501',
  'a restricted custom field cannot be changed by this role',
  'a hidden custom field cannot be written'
);

select lives_ok(
  $$select public.save_workspace(
      '21000000-0000-4000-8000-000000000091',
      0,
      '91000000-0000-4000-8000-000000000096',
      '{"members":{"upsert":[{"id":"31000000-0000-4000-8000-000000000091","initials":"PP","name":"計画 太郎","role":"Planner","department":"第一本部","location":"大阪","capacity":100,"customValues":{}}],"archiveIds":[]}}'::jsonb,
      repeat('f', 64)
    )$$,
  'a member edit that omits a hidden custom field is accepted'
);

reset role;

select is(
  (
    select field_value.value_text
    from app.custom_field_values as field_value
    where field_value.organization_id = '21000000-0000-4000-8000-000000000091'
      and field_value.field_id = '51000000-0000-4000-8000-000000000091'
      and field_value.entity_id = '31000000-0000-4000-8000-000000000091'
  ),
  'B',
  'a hidden custom field keeps its stored value across a member edit'
);

select * from finish();
rollback;
