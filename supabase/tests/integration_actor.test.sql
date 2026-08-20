begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000111', 'actor-owner@test.local', '{"full_name":"Actor Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000112', 'actor-admin@test.local', '{"full_name":"Actor Admin"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000111',
  'Actor Binding Tenant',
  'actor-binding-tenant-test',
  '11000000-0000-4000-8000-000000000111',
  '11000000-0000-4000-8000-000000000111',
  '11000000-0000-4000-8000-000000000111'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  ('21000000-0000-4000-8000-000000000111', '11000000-0000-4000-8000-000000000111', 'owner', 'active',
   '11000000-0000-4000-8000-000000000111', '11000000-0000-4000-8000-000000000111'),
  ('21000000-0000-4000-8000-000000000111', '11000000-0000-4000-8000-000000000112', 'admin', 'active',
   '11000000-0000-4000-8000-000000000111', '11000000-0000-4000-8000-000000000111');

-- A credential issued by the admin, plus a role permission that only restricts admins.
insert into app.integration_clients (
  id, organization_id, name, key_prefix, secret_hash, scopes, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000111',
  '21000000-0000-4000-8000-000000000111',
  'Admin issued',
  'aaaaaaaaaaaa',
  repeat('a', 64),
  array['workspace:read']::text[],
  '11000000-0000-4000-8000-000000000112',
  '11000000-0000-4000-8000-000000000112'
);

insert into app.role_permissions (
  organization_id, role, person_scope, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000111',
  'admin',
  'self',
  '11000000-0000-4000-8000-000000000111',
  '11000000-0000-4000-8000-000000000111'
);

select is(
  (select client.created_by from app.integration_clients as client where client.id = '61000000-0000-4000-8000-000000000111'),
  '11000000-0000-4000-8000-000000000112'::uuid,
  'the credential records its issuer'
);

select is(
  (select (private.become_integration_actor('61000000-0000-4000-8000-000000000111')).id),
  '61000000-0000-4000-8000-000000000111'::uuid,
  'an eligible issuer still binds the request'
);

select is(
  current_setting('request.jwt.claim.sub', true),
  '11000000-0000-4000-8000-000000000112',
  'the request binds to the issuer, not to another administrator'
);

-- The issuer loses its eligible role. The credential stays active.
update app.organization_memberships as membership
   set role = 'viewer'
 where membership.organization_id = '21000000-0000-4000-8000-000000000111'
   and membership.user_id = '11000000-0000-4000-8000-000000000112';

select is(
  (select client.status from app.integration_clients as client where client.id = '61000000-0000-4000-8000-000000000111'),
  'active',
  'demoting the issuer does not revoke the credential on its own'
);

-- Before the fix this fell back to the owner and quietly widened the applied
-- role permissions. It must stop instead.
select throws_ok(
  $$select private.become_integration_actor('61000000-0000-4000-8000-000000000111')$$,
  '42501',
  'invalid credential',
  'a credential whose issuer lost its role stops instead of escalating to an owner'
);

select throws_ok(
  $$select public.integration_get_workspace('61000000-0000-4000-8000-000000000111')$$,
  '42501',
  'invalid credential',
  'the read path refuses the credential too'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000111';

select is(
  (
    select entry.client -> 'actorEligible'
    from jsonb_array_elements(public.list_integration_clients('21000000-0000-4000-8000-000000000111') -> 'clients') as entry(client)
    where entry.client ->> 'id' = '61000000-0000-4000-8000-000000000111'
  ),
  'false'::jsonb,
  'owners can see that the credential has no eligible issuer'
);

select * from finish();
rollback;
