begin;

-- External API adapter support: impersonated workspace RPCs for verified
-- integration clients, plus webhook subscriptions and an outbox.

create table app.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  url text not null check (char_length(url) between 12 and 2048),
  signing_secret text not null check (char_length(signing_secret) = 64),
  events text[] not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  check ((status = 'revoked') = (revoked_at is not null)),
  check (
    events <@ array[
      'workspace.committed',
      'member.changed',
      'project.changed',
      'assignment.changed',
      'staffing_need.changed'
    ]::text[]
  ),
  check (array_length(events, 1) between 1 and 5)
);

create unique index webhook_endpoints_org_active_url_idx
  on app.webhook_endpoints (organization_id, url)
  where status = 'active';
create index webhook_endpoints_org_status_idx
  on app.webhook_endpoints (organization_id, status, created_at desc);

create table app.webhook_outbox (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app.organizations (id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now()
);

create index webhook_outbox_pending_idx
  on app.webhook_outbox (available_at, id)
  where delivered_at is null and failed_at is null;

alter table app.webhook_endpoints enable row level security;
alter table app.webhook_endpoints force row level security;
alter table app.webhook_outbox enable row level security;
alter table app.webhook_outbox force row level security;

create trigger webhook_endpoints_touch
before insert or update on app.webhook_endpoints
for each row execute function private.touch_versioned_row();

create or replace function private.enqueue_workspace_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
     and new.workspace_revision is distinct from old.workspace_revision then
    insert into app.webhook_outbox (organization_id, event_type, payload)
    values (
      new.id,
      'workspace.committed',
      jsonb_build_object(
        'type', 'workspace.committed',
        'organizationId', new.id,
        'revision', new.workspace_revision,
        'requestId', nullif(current_setting('app.request_id', true), ''),
        'callerKind', coalesce(nullif(current_setting('app.caller_kind', true), ''), 'user')
      )
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists organizations_webhook_outbox on app.organizations;
create trigger organizations_webhook_outbox
after update on app.organizations
for each row execute function private.enqueue_workspace_webhook();

create or replace function private.webhook_url_is_public_https(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_url text := btrim(p_url);
  v_host text;
begin
  if v_url is null or v_url !~ '^https://[^[:space:]/@]+(/.*)?$' then
    return false;
  end if;
  if position('@' in v_url) > 0 then
    return false;
  end if;
  v_host := lower(substring(v_url from '^https://([^/:]+)'));
  if v_host is null or v_host = '' then
    return false;
  end if;
  if v_host in ('localhost', 'metadata.google.internal')
     or v_host ~ '\.(local|internal|localhost)$' then
    return false;
  end if;
  if v_host ~ '^[0-9.]+$' and (
    v_host = '0.0.0.0'
    or v_host ~ '^127\.'
    or v_host ~ '^10\.'
    or v_host ~ '^192\.168\.'
    or v_host ~ '^169\.254\.'
    or v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.'
    or v_host ~ '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.'
  ) then
    return false;
  end if;
  if v_host ~ ':' and (
    v_host in ('::1', '[::1]')
    or v_host ~ '^\[?::1\]?$'
    or v_host ~ '^\[?f[cd]'
    or v_host ~ '^\[?fe[89ab]'
  ) then
    return false;
  end if;
  return true;
end;
$function$;

create or replace function private.enqueue_entity_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_type text;
  v_org uuid;
  v_id uuid;
begin
  v_type := case tg_table_name
    when 'people' then 'member.changed'
    when 'projects' then 'project.changed'
    when 'assignments' then 'assignment.changed'
    when 'staffing_needs' then 'staffing_need.changed'
  end;
  if v_type is null then
    return coalesce(new, old);
  end if;
  v_org := coalesce(new.organization_id, old.organization_id);
  v_id := coalesce(new.id, old.id);
  insert into app.webhook_outbox (organization_id, event_type, payload)
  values (
    v_org,
    v_type,
    jsonb_build_object(
      'type', v_type,
      'organizationId', v_org,
      'entityId', v_id,
      'requestId', nullif(current_setting('app.request_id', true), ''),
      'callerKind', coalesce(nullif(current_setting('app.caller_kind', true), ''), 'user')
    )
  );
  return coalesce(new, old);
end;
$function$;

drop trigger if exists people_webhook_outbox on app.people;
create trigger people_webhook_outbox
after insert or update on app.people
for each row execute function private.enqueue_entity_webhook();

drop trigger if exists projects_webhook_outbox on app.projects;
create trigger projects_webhook_outbox
after insert or update on app.projects
for each row execute function private.enqueue_entity_webhook();

drop trigger if exists assignments_webhook_outbox on app.assignments;
create trigger assignments_webhook_outbox
after insert or update on app.assignments
for each row execute function private.enqueue_entity_webhook();

drop trigger if exists staffing_needs_webhook_outbox on app.staffing_needs;
create trigger staffing_needs_webhook_outbox
after insert or update on app.staffing_needs
for each row execute function private.enqueue_entity_webhook();

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

  v_actor := v_client.created_by;
  if v_actor is null or not exists (
    select 1
    from app.organization_memberships as membership
    where membership.organization_id = v_client.organization_id
      and membership.user_id = v_actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'planner')
  ) then
    select membership.user_id
    into v_actor
    from app.organization_memberships as membership
    where membership.organization_id = v_client.organization_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by case membership.role when 'owner' then 0 else 1 end, membership.user_id
    limit 1;
  end if;
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

create or replace function private.assert_integration_payload_scopes(
  p_client app.integration_clients,
  p_payload jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'p_payload must be a JSON object';
  end if;
  if (p_payload ? 'members' or p_payload ? 'skillCatalog')
     and not ('members:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'members:write is required';
  end if;
  if (p_payload ? 'projects' or p_payload ? 'customFields')
     and not ('projects:write' = any (p_client.scopes) or 'members:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'projects:write is required';
  end if;
  if p_payload ? 'assignments' and not ('assignments:write' = any (p_client.scopes) or 'staffing:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'assignments:write is required';
  end if;
  if p_payload ? 'needs' and not ('staffing:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'staffing:write is required';
  end if;
end;
$function$;

create or replace function public.integration_get_workspace(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_client app.integration_clients%rowtype;
begin
  v_client := private.become_integration_actor(p_client_id);
  if not ('workspace:read' = any (v_client.scopes)) then
    raise exception using errcode = '42501', message = 'workspace:read is required';
  end if;
  return public.get_workspace(v_client.organization_id);
end;
$function$;

comment on function public.integration_get_workspace(uuid) is $comment$
Service-role only. Loads a workspace snapshot for an active integration client
after binding the request to a human issuer for RLS/RPC reuse.
$comment$;

create or replace function public.integration_save_workspace(
  p_client_id uuid,
  p_expected_revision bigint,
  p_request_id uuid,
  p_payload jsonb,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_client app.integration_clients%rowtype;
begin
  v_client := private.become_integration_actor(p_client_id);
  perform private.assert_integration_payload_scopes(v_client, p_payload);
  return public.save_workspace(
    v_client.organization_id,
    p_expected_revision,
    p_request_id,
    p_payload,
    p_payload_hash
  );
end;
$function$;

comment on function public.integration_save_workspace(uuid, bigint, uuid, jsonb, text) is $comment$
Service-role only. Saves a catalogued workspace payload for an integration
client. Caller kind is recorded as integration.
$comment$;

create or replace function private.webhook_endpoint_public_json(p_endpoint app.webhook_endpoints)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_endpoint.id,
    'organizationId', p_endpoint.organization_id,
    'name', p_endpoint.name,
    'url', p_endpoint.url,
    'events', to_jsonb(p_endpoint.events),
    'status', p_endpoint.status,
    'createdAt', p_endpoint.created_at,
    'revokedAt', p_endpoint.revoked_at
  );
$function$;

create or replace function public.create_webhook_endpoint(
  p_organization_id uuid,
  p_name text,
  p_url text,
  p_events text[],
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_name text := btrim(p_name);
  v_url text := btrim(p_url);
  v_events text[];
  v_secret text;
  v_endpoint app.webhook_endpoints%rowtype;
  v_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id and p_request_id are required';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'endpoint name must contain 1 to 80 characters';
  end if;
  if v_url is null or v_url !~ '^https://[^[:space:]]+$' then
    raise exception using errcode = '22023', message = 'webhook URL must be https';
  end if;
  v_url := left(v_url, 2048);
  if not private.webhook_url_is_public_https(v_url) then
    raise exception using errcode = '22023', message = 'webhook URL must be a public https address';
  end if;

  select array_agg(distinct event_name order by event_name)
  into v_events
  from unnest(coalesce(p_events, array[]::text[])) as event_name
  where event_name in (
    'workspace.committed',
    'member.changed',
    'project.changed',
    'assignment.changed',
    'staffing_need.changed'
  );
  if coalesce(array_length(v_events, 1), 0) <> coalesce(array_length(p_events, 1), 0)
     or v_events is null then
    raise exception using errcode = '22023', message = 'p_events contains an unsupported value';
  end if;

  perform 1
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor
    and membership.status = 'active';
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select count(*)
  into v_count
  from app.webhook_endpoints as endpoint
  where endpoint.organization_id = p_organization_id
    and endpoint.status = 'active';
  if v_count >= 10 then
    raise exception using errcode = '54000', message = 'an organization may have at most 10 webhook endpoints';
  end if;

  perform set_config('app.request_id', p_request_id::text, true);
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');

  insert into app.webhook_endpoints (
    organization_id,
    name,
    url,
    signing_secret,
    events,
    status,
    created_by,
    updated_by
  ) values (
    p_organization_id,
    v_name,
    v_url,
    v_secret,
    v_events,
    'active',
    v_actor,
    v_actor
  )
  returning * into v_endpoint;

  return jsonb_build_object(
    'endpoint', private.webhook_endpoint_public_json(v_endpoint),
    'secret', v_secret,
    'requestId', p_request_id,
    'replayed', false
  );
end;
$function$;

create or replace function public.list_webhook_endpoints(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor
    and membership.status = 'active';
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select jsonb_build_object(
    'endpoints', coalesce(jsonb_agg(
      private.webhook_endpoint_public_json(endpoint)
      order by endpoint.created_at desc, endpoint.id
    ), '[]'::jsonb)
  )
  into v_result
  from app.webhook_endpoints as endpoint
  where endpoint.organization_id = p_organization_id;

  return v_result;
end;
$function$;

create or replace function public.revoke_webhook_endpoint(
  p_organization_id uuid,
  p_endpoint_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_endpoint app.webhook_endpoints%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_endpoint_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id, p_endpoint_id, and p_request_id are required';
  end if;

  perform 1
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor
    and membership.status = 'active';
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select endpoint.*
  into v_endpoint
  from app.webhook_endpoints as endpoint
  where endpoint.organization_id = p_organization_id
    and endpoint.id = p_endpoint_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'webhook endpoint not found';
  end if;
  if v_endpoint.status = 'revoked' then
    return jsonb_build_object(
      'changed', false,
      'requestId', p_request_id,
      'endpoint', private.webhook_endpoint_public_json(v_endpoint)
    );
  end if;

  perform set_config('app.request_id', p_request_id::text, true);
  update app.webhook_endpoints as endpoint
  set
    status = 'revoked',
    revoked_at = now(),
    updated_by = v_actor
  where endpoint.id = v_endpoint.id
  returning endpoint.* into v_endpoint;

  return jsonb_build_object(
    'changed', true,
    'requestId', p_request_id,
    'endpoint', private.webhook_endpoint_public_json(v_endpoint)
  );
end;
$function$;

create or replace function public.claim_webhook_outbox(
  p_organization_id uuid,
  p_limit integer default 5
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_result jsonb;
begin
  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id is required';
  end if;

  with pending as (
    select outbox.id
    from app.webhook_outbox as outbox
    where outbox.organization_id = p_organization_id
      and outbox.delivered_at is null
      and outbox.failed_at is null
      and outbox.available_at <= now()
      and outbox.attempts < 8
    order by outbox.id
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update app.webhook_outbox as outbox
    set
      claimed_at = now(),
      attempts = outbox.attempts + 1
    from pending
    where outbox.id = pending.id
    returning outbox.*
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', claimed.id,
        'organizationId', claimed.organization_id,
        'eventType', claimed.event_type,
        'payload', claimed.payload,
        'attempts', claimed.attempts,
        'endpoints', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', endpoint.id,
            'url', endpoint.url,
            'secret', endpoint.signing_secret,
            'events', to_jsonb(endpoint.events)
          ) order by endpoint.id)
          from app.webhook_endpoints as endpoint
          where endpoint.organization_id = claimed.organization_id
            and endpoint.status = 'active'
            and claimed.event_type = any (endpoint.events)
        ), '[]'::jsonb)
      ) order by claimed.id
    ), '[]'::jsonb)
  )
  into v_result
  from claimed;

  return coalesce(v_result, '{"items":[]}'::jsonb);
end;
$function$;

create or replace function public.complete_webhook_outbox(
  p_outbox_id bigint,
  p_ok boolean,
  p_error text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_outbox app.webhook_outbox%rowtype;
begin
  if p_outbox_id is null then
    raise exception using errcode = '22023', message = 'p_outbox_id is required';
  end if;

  update app.webhook_outbox as outbox
  set
    delivered_at = case when p_ok then now() else outbox.delivered_at end,
    failed_at = case when p_ok then null when outbox.attempts >= 8 then now() else outbox.failed_at end,
    available_at = case when p_ok then outbox.available_at else now() + (interval '1 minute' * least(outbox.attempts, 30)) end,
    last_error = case when p_ok then null else left(coalesce(p_error, 'delivery failed'), 500) end
  where outbox.id = p_outbox_id
  returning outbox.* into v_outbox;
  if not found then
    raise exception using errcode = 'P0002', message = 'webhook outbox item not found';
  end if;
  return jsonb_build_object(
    'id', v_outbox.id,
    'delivered', v_outbox.delivered_at is not null,
    'failed', v_outbox.failed_at is not null
  );
end;
$function$;

revoke all on function private.enqueue_workspace_webhook() from public, anon, authenticated;
revoke all on function private.webhook_url_is_public_https(text) from public, anon, authenticated;
revoke all on function private.enqueue_entity_webhook() from public, anon, authenticated;
revoke all on function private.become_integration_actor(uuid) from public, anon, authenticated;
revoke all on function private.assert_integration_payload_scopes(app.integration_clients, jsonb) from public, anon, authenticated;
revoke all on function private.webhook_endpoint_public_json(app.webhook_endpoints) from public, anon, authenticated;
revoke all on function public.integration_get_workspace(uuid) from public, anon, authenticated, service_role;
revoke all on function public.integration_save_workspace(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.create_webhook_endpoint(uuid, text, text, text[], uuid) from public, anon, authenticated;
revoke all on function public.list_webhook_endpoints(uuid) from public, anon, authenticated;
revoke all on function public.revoke_webhook_endpoint(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_webhook_outbox(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_webhook_outbox(bigint, boolean, text) from public, anon, authenticated, service_role;

grant execute on function public.create_webhook_endpoint(uuid, text, text, text[], uuid) to authenticated;
grant execute on function public.list_webhook_endpoints(uuid) to authenticated;
grant execute on function public.revoke_webhook_endpoint(uuid, uuid, uuid) to authenticated;
grant execute on function public.integration_get_workspace(uuid) to service_role;
grant execute on function public.integration_save_workspace(uuid, bigint, uuid, jsonb, text) to service_role;
grant execute on function public.claim_webhook_outbox(uuid, integer) to service_role;
grant execute on function public.complete_webhook_outbox(bigint, boolean, text) to service_role;

revoke all on table app.webhook_endpoints from public, anon, authenticated, service_role;
revoke all on table app.webhook_outbox from public, anon, authenticated, service_role;

commit;
