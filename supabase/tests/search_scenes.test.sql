begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000021', 'scenes-owner@test.local', '{"full_name":"Scenes Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000021',
  'Scenes Tenant',
  'scenes-tenant-test',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

insert into app.search_scenes (
  id, organization_id, name, role_title, skills, created_by, updated_by
) values (
  '51000000-0000-4000-8000-000000000021',
  '21000000-0000-4000-8000-000000000021',
  'フロントエンド候補',
  'Frontend Engineer',
  '[{"name":"React","minProficiency":3,"importance":"must"},{"name":"A11y","minProficiency":3,"importance":"nice"}]'::jsonb,
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000021';

select ok(
  (select jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000021') -> 'searchScenes') = 1),
  'get_workspace includes search scenes'
);

select is(
  (
    select item ->> 'role'
    from jsonb_array_elements(public.get_workspace('21000000-0000-4000-8000-000000000021') -> 'searchScenes') as item
    where item ->> 'name' = 'フロントエンド候補'
  ),
  'Frontend Engineer',
  'get_workspace returns search scene role'
);

reset role;

select has_function(
  'private',
  'apply_search_scenes',
  array['uuid', 'jsonb', 'uuid'],
  'search scene apply helper exists'
);

select has_table('app', 'search_scenes', 'search scenes table exists');

select throws_ok(
  $$insert into app.search_scenes (
      id, organization_id, name, start_date, created_by, updated_by
    ) values (
      '51000000-0000-4000-8000-000000000022',
      '21000000-0000-4000-8000-000000000021',
      '期間不正',
      '2026-08-24',
      '11000000-0000-4000-8000-000000000021',
      '11000000-0000-4000-8000-000000000021'
    )$$,
  '23514',
  'new row for relation "search_scenes" violates check constraint "search_scenes_period_check"',
  'search scenes require both start and end dates when a period is set'
);

select * from finish();
rollback;
