begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000021', 'favorites-owner@test.local', '{"full_name":"Favorites Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000022', 'favorites-viewer@test.local', '{"full_name":"Favorites Viewer"}'::jsonb),
  ('11000000-0000-4000-8000-000000000023', 'favorites-outsider@test.local', '{"full_name":"Favorites Outsider"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000021',
  'Favorites Tenant',
  'favorites-tenant-test',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
), (
  '21000000-0000-4000-8000-000000000022',
  'Other Tenant',
  'favorites-other-test',
  '11000000-0000-4000-8000-000000000023',
  '11000000-0000-4000-8000-000000000023',
  '11000000-0000-4000-8000-000000000023'
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
), (
  '21000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000022',
  'viewer',
  'active',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
), (
  '21000000-0000-4000-8000-000000000022',
  '11000000-0000-4000-8000-000000000023',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000023',
  '11000000-0000-4000-8000-000000000023'
);

insert into app.people (
  id, organization_id, initials, name, role_title, department, avatar_tone,
  location, capacity_percent, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000021',
  '21000000-0000-4000-8000-000000000021',
  'FO',
  'Favorite Person',
  'Engineer',
  'Platform',
  'mint',
  'Tokyo',
  100,
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

insert into app.projects (
  id, organization_id, code, name, summary, status, tone, start_date, end_date,
  next_milestone, progress_percent, demand_headcount, created_by, updated_by
) values (
  '62000000-0000-4000-8000-000000000021',
  '21000000-0000-4000-8000-000000000021',
  'FAV',
  'Favorites Project',
  'Personal star coverage',
  '進行中',
  'blue',
  '2026-08-01',
  '2026-12-31',
  'Review',
  10,
  2,
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

select ok(
  not has_table_privilege('authenticated', 'app.favorites', 'SELECT'),
  'authenticated cannot select favorites directly'
);
select ok(
  not has_table_privilege('authenticated', 'app.favorites', 'INSERT'),
  'authenticated cannot insert favorites directly'
);
select ok(
  not has_table_privilege('anon', 'app.favorites', 'SELECT'),
  'anon cannot select favorites'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000021';

select is(
  public.set_favorite(
    '21000000-0000-4000-8000-000000000021',
    'member',
    '61000000-0000-4000-8000-000000000021',
    true
  ),
  '{"favorites":[{"kind":"member","targetId":"61000000-0000-4000-8000-000000000021"}]}'::jsonb,
  'an owner can star a member'
);

select is(
  public.set_favorite(
    '21000000-0000-4000-8000-000000000021',
    'project',
    '62000000-0000-4000-8000-000000000021',
    true
  ) -> 'favorites',
  '[{"kind":"member","targetId":"61000000-0000-4000-8000-000000000021"},{"kind":"project","targetId":"62000000-0000-4000-8000-000000000021"}]'::jsonb,
  'an owner can star a project and keep both favorites'
);

select throws_ok(
  $sql$select public.list_favorites('21000000-0000-4000-8000-000000000022')$sql$,
  '42501',
  'not authorized',
  'an owner cannot list another tenant favorites'
);

select throws_ok(
  $sql$select public.set_favorite(
    '21000000-0000-4000-8000-000000000021',
    'member',
    '61000000-0000-4000-8000-000000000099',
    true
  )$sql$,
  'P0002',
  'favorite member not found',
  'unknown members cannot be starred'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000022';

select is(
  public.list_favorites('21000000-0000-4000-8000-000000000021'),
  '{"favorites":[]}'::jsonb,
  'a viewer does not see another user favorites'
);

select is(
  (public.set_favorite(
    '21000000-0000-4000-8000-000000000021',
    'member',
    '61000000-0000-4000-8000-000000000021',
    true
  ) -> 'favorites' -> 0 ->> 'targetId'),
  '61000000-0000-4000-8000-000000000021',
  'a viewer can keep a personal favorite'
);

select is(
  (public.set_favorite(
    '21000000-0000-4000-8000-000000000021',
    'member',
    '61000000-0000-4000-8000-000000000021',
    false
  ) -> 'favorites'),
  '[]'::jsonb,
  'unstar removes only the caller row'
);

reset role;
set local request.jwt.claim.role = '';
set local request.jwt.claim.sub = '';

select throws_ok(
  $sql$select public.list_favorites('21000000-0000-4000-8000-000000000021')$sql$,
  '42501',
  'authentication required',
  'unauthenticated callers cannot list favorites'
);

select * from finish();
rollback;
