begin;

-- An integration credential runs as the human who issued it, so that role's
-- permissions apply. The previous definition fell back to an arbitrary owner or
-- admin when the issuer was no longer eligible, and nothing revokes a credential
-- when its issuer is demoted or suspended. The applied role permissions then
-- relaxed on their own. Stop instead of escalating: the credential fails closed
-- until an owner or admin revokes and re-issues it.
create or replace function private.become_integration_actor(p_client_id uuid)
returns app.integration_clients
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_client app.integration_clients%rowtype;
  v_actor uuid;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'p_client_id is required';
  end if;

  select client.*
  into v_client
  from app.integration_clients as client
  where client.id = p_client_id
    and client.status = 'active'
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'invalid credential';
  end if;

  perform 1
  from app.organizations as organization
  where organization.id = v_client.organization_id
    and organization.archived_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'invalid credential';
  end if;

  -- Only the issuer, and only while it still holds an eligible role. The message
  -- stays generic so the holder learns nothing about why it stopped; owners and
  -- admins see the reason through list_integration_clients.actorEligible.
  select membership.user_id
  into v_actor
  from app.organization_memberships as membership
  where membership.organization_id = v_client.organization_id
    and membership.user_id = v_client.created_by
    and membership.status = 'active'
    and membership.role in ('owner', 'admin', 'planner');
  if v_actor is null then
    raise exception using errcode = '42501', message = 'invalid credential';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor, 'role', 'authenticated')::text,
    true
  );
  perform set_config('app.caller_kind', 'integration', true);
  perform set_config('app.integration_client_id', v_client.id::text, true);
  return v_client;
end;
$function$;

-- Adds actorEligible so an owner or admin can tell a credential that stopped
-- working from one that is merely unused. Computed here, not stored: the answer
-- changes whenever a membership changes.
create or replace function public.list_integration_clients(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_result jsonb;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id is required';
  end if;

  select membership.role
  into v_actor_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor_id
    and membership.status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select jsonb_build_object(
    'clients', coalesce(jsonb_agg(
      private.integration_client_public_json(client, creator.display_name)
        || jsonb_build_object('actorEligible', exists (
             select 1
             from app.organization_memberships as issuer
             where issuer.organization_id = client.organization_id
               and issuer.user_id = client.created_by
               and issuer.status = 'active'
               and issuer.role in ('owner', 'admin', 'planner')
           ))
      order by client.created_at desc, client.id
    ), '[]'::jsonb)
  )
  into v_result
  from app.integration_clients as client
  left join app.profiles as creator on creator.id = client.created_by
  where client.organization_id = p_organization_id;

  return v_result;
end;
$function$;

comment on function private.become_integration_actor(uuid) is $comment$
Binds the request to the human who issued the credential so their organization
role and role permissions apply. Raises 42501 when the issuer is no longer an
active owner, admin, or planner: the credential stops rather than escalating to
another administrator. Revoking and re-issuing is an owner or admin decision.
$comment$;

comment on function public.list_integration_clients(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns {"clients":[{id,name,keyPrefix,scopes,status,createdAt,createdByName,revokedAt,lastUsedAt,actorEligible}]}.
actorEligible is false when the issuer no longer holds an active owner, admin, or
planner role, which means the credential is refused with 42501. Secrets are never
included. Owner/admin only.
$comment$;

revoke all on function private.become_integration_actor(uuid) from public, anon, authenticated;
revoke all on function public.list_integration_clients(uuid) from public, anon, authenticated;

grant execute on function public.list_integration_clients(uuid) to authenticated;

commit;
