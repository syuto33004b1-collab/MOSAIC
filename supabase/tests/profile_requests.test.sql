begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000041', 'profile-owner@test.local', '{"full_name":"Profile Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000041',
  'Profile Tenant',
  'profile-tenant-test',
  '11000000-0000-4000-8000-000000000041',
  '11000000-0000-4000-8000-000000000041',
  '11000000-0000-4000-8000-000000000041'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000041',
  '11000000-0000-4000-8000-000000000041',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000041',
  '11000000-0000-4000-8000-000000000041'
);

insert into app.people (
  id, organization_id, initials, name, role_title, department, avatar_tone, location, capacity_percent, created_by, updated_by
) values (
  '31000000-0000-4000-8000-000000000041',
  '21000000-0000-4000-8000-000000000041',
  'MN',
  '中村 美咲',
  'Frontend Engineer',
  'プロダクト開発',
  'peach',
  '東京',
  100,
  '11000000-0000-4000-8000-000000000041',
  '11000000-0000-4000-8000-000000000041'
);

insert into app.profile_requests (
  id, organization_id, person_id, scope, note, status, created_by, updated_by
) values (
  '51000000-0000-4000-8000-000000000041',
  '21000000-0000-4000-8000-000000000041',
  '31000000-0000-4000-8000-000000000041',
  'skills',
  'スキルを更新してください',
  'open',
  '11000000-0000-4000-8000-000000000041',
  '11000000-0000-4000-8000-000000000041'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000041';

select ok(
  (select jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000041') -> 'profileRequests') = 1),
  'get_workspace includes profile requests'
);

select is(
  (
    select item ->> 'scope'
    from jsonb_array_elements(public.get_workspace('21000000-0000-4000-8000-000000000041') -> 'profileRequests') as item
    where item ->> 'personId' = '31000000-0000-4000-8000-000000000041'
  ),
  'skills',
  'get_workspace returns profile request scope'
);

reset role;

select has_function(
  'private',
  'apply_profile_requests',
  array['uuid', 'jsonb', 'uuid'],
  'profile request apply helper exists'
);

select has_function(
  'public',
  'submit_profile_request',
  array['uuid', 'uuid', 'uuid', 'bigint', 'jsonb'],
  'profile request submit rpc exists'
);

select throws_ok(
  $$insert into app.profile_requests (
      id, organization_id, person_id, scope, status, created_by, updated_by
    ) values (
      '51000000-0000-4000-8000-000000000042',
      '21000000-0000-4000-8000-000000000041',
      '31000000-0000-4000-8000-000000000041',
      'all',
      'open',
      '11000000-0000-4000-8000-000000000041',
      '11000000-0000-4000-8000-000000000041'
    )$$,
  '23505',
  'duplicate key value violates unique constraint "profile_requests_active_person_idx"',
  'one active profile request per person'
);

select * from finish();
rollback;
