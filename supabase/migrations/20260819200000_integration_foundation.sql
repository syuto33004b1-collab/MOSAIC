begin;

-- Shared integration foundation: catalogued credentials, rate windows, and
-- caller-aware audit. REST API and MCP endpoints stay in later issues.
-- Secret material is stored as SHA-256 only; plaintext is returned once.

create table app.integration_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  key_prefix text not null check (key_prefix ~ '^[0-9a-f]{12}$'),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  unique (key_prefix),
  check ((status = 'revoked') = (revoked_at is not null)),
  check (
    scopes <@ array[
      'workspace:read',
      'members:write',
      'projects:write',
      'assignments:write',
      'staffing:write'
    ]::text[]
  ),
  check (array_length(scopes, 1) between 1 and 5),
  check ('workspace:read' = any (scopes))
);

create unique index integration_clients_org_active_name_idx
  on app.integration_clients (organization_id, lower(btrim(name)))
  where status = 'active';
create index integration_clients_org_status_idx
  on app.integration_clients (organization_id, status, created_at desc);

create table app.integration_client_requests (
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  organization_id uuid not null references app.organizations (id) on delete cascade,
  requested_name text not null,
  requested_scopes text[] not null,
  client_id uuid references app.integration_clients (id) on delete restrict,
  completed_at timestamptz,
  primary key (actor_user_id, request_id),
  check ((client_id is null) = (completed_at is null))
);

create table app.integration_rate_windows (
  client_id uuid not null references app.integration_clients (id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (client_id, window_started_at)
);

alter table app.audit_events
  add column caller_kind text not null default 'user'
    check (caller_kind in ('user', 'ai', 'integration')),
  add column integration_client_id uuid references app.integration_clients (id) on delete set null;

create index audit_events_caller_idx
  on app.audit_events (organization_id, caller_kind, id desc);
create index audit_events_integration_idx
  on app.audit_events (organization_id, integration_client_id, id desc)
  where integration_client_id is not null;

alter table app.integration_clients enable row level security;
alter table app.integration_clients force row level security;
alter table app.integration_client_requests enable row level security;
alter table app.integration_client_requests force row level security;
alter table app.integration_rate_windows enable row level security;
alter table app.integration_rate_windows force row level security;

create trigger integration_clients_touch
before insert or update on app.integration_clients
for each row execute function private.touch_versioned_row();

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_organization_id uuid;
  v_entity_id uuid;
  v_entity_key jsonb;
  v_revision bigint;
  v_request_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_caller_kind text;
  v_integration_client_id uuid;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  if tg_table_name = 'organizations' then
    v_organization_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  else
    v_organization_id := coalesce(
      (v_new ->> 'organization_id')::uuid,
      (v_old ->> 'organization_id')::uuid
    );
  end if;

  if tg_table_name = 'person_skills' then
    v_entity_id := coalesce((v_new ->> 'person_id')::uuid, (v_old ->> 'person_id')::uuid);
    v_entity_key := jsonb_build_object(
      'personId', coalesce(v_new ->> 'person_id', v_old ->> 'person_id'),
      'skillId', coalesce(v_new ->> 'skill_id', v_old ->> 'skill_id')
    );
  elsif tg_table_name = 'staffing_need_skills' then
    v_entity_id := coalesce((v_new ->> 'staffing_need_id')::uuid, (v_old ->> 'staffing_need_id')::uuid);
    v_entity_key := jsonb_build_object(
      'staffingNeedId', coalesce(v_new ->> 'staffing_need_id', v_old ->> 'staffing_need_id'),
      'skillId', coalesce(v_new ->> 'skill_id', v_old ->> 'skill_id')
    );
  else
    v_entity_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
    v_entity_key := jsonb_build_object('id', v_entity_id);
  end if;
  v_request_id := nullif(current_setting('app.request_id', true), '')::uuid;
  v_caller_kind := coalesce(nullif(current_setting('app.caller_kind', true), ''), 'user');
  if v_caller_kind not in ('user', 'ai', 'integration') then
    v_caller_kind := 'user';
  end if;
  v_integration_client_id := nullif(current_setting('app.integration_client_id', true), '')::uuid;

  select organization.workspace_revision
  into v_revision
  from app.organizations as organization
  where organization.id = v_organization_id;

  insert into app.audit_events (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    entity_key,
    request_id,
    workspace_revision,
    old_data,
    new_data,
    caller_kind,
    integration_client_id
  ) values (
    v_organization_id,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_entity_id,
    v_entity_key,
    v_request_id,
    coalesce(v_revision, 0),
    v_old,
    v_new,
    v_caller_kind,
    v_integration_client_id
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function private.allowed_integration_scopes()
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select array[
    'workspace:read',
    'members:write',
    'projects:write',
    'assignments:write',
    'staffing:write'
  ]::text[];
$function$;

create or replace function private.normalize_integration_scopes(p_scopes text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_scopes text[];
  v_input_count integer;
begin
  if p_scopes is null then
    raise exception using errcode = '22023', message = 'p_scopes is required';
  end if;
  select count(*) into v_input_count from unnest(p_scopes) as scope;
  if v_input_count < 1 or v_input_count > 5 then
    raise exception using errcode = '22023', message = 'p_scopes must contain 1 to 5 values';
  end if;
  select array_agg(distinct scope order by scope)
  into v_scopes
  from unnest(p_scopes) as scope
  where scope = any (private.allowed_integration_scopes());
  if coalesce(array_length(v_scopes, 1), 0) <> v_input_count then
    raise exception using errcode = '22023', message = 'p_scopes contains an unsupported value';
  end if;
  if not ('workspace:read' = any (v_scopes)) then
    raise exception using errcode = '22023', message = 'workspace:read is required';
  end if;
  return v_scopes;
end;
$function$;

create or replace function private.integration_client_public_json(
  p_client app.integration_clients,
  p_created_by_name text default null
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_client.id,
    'organizationId', p_client.organization_id,
    'name', p_client.name,
    'keyPrefix', p_client.key_prefix,
    'scopes', to_jsonb(p_client.scopes),
    'status', p_client.status,
    'createdAt', p_client.created_at,
    'createdByUserId', p_client.created_by,
    'createdByName', p_created_by_name,
    'revokedAt', p_client.revoked_at,
    'lastUsedAt', p_client.last_used_at
  );
$function$;

create or replace function private.record_integration_client_audit(
  p_organization_id uuid,
  p_client_id uuid,
  p_action text,
  p_request_id uuid,
  p_old jsonb,
  p_new jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_revision bigint;
begin
  select organization.workspace_revision
  into v_revision
  from app.organizations as organization
  where organization.id = p_organization_id;

  insert into app.audit_events (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    entity_key,
    request_id,
    workspace_revision,
    old_data,
    new_data,
    caller_kind
  ) values (
    p_organization_id,
    auth.uid(),
    p_action,
    'integration_clients',
    p_client_id,
    jsonb_build_object('id', p_client_id),
    p_request_id,
    coalesce(v_revision, 0),
    p_old,
    p_new,
    'user'
  );
end;
$function$;

create or replace function public.create_integration_client(
  p_organization_id uuid,
  p_name text,
  p_scopes text[],
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_name text := btrim(p_name);
  v_scopes text[];
  v_raw text;
  v_prefix text;
  v_secret text;
  v_hash text;
  v_client app.integration_clients%rowtype;
  v_request app.integration_client_requests%rowtype;
  v_active_count integer;
  v_attempt integer;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id and p_request_id are required';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'client name must contain 1 to 80 characters';
  end if;
  v_scopes := private.normalize_integration_scopes(p_scopes);

  perform 1
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
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

  insert into app.integration_client_requests (
    actor_user_id,
    request_id,
    organization_id,
    requested_name,
    requested_scopes
  ) values (
    v_actor_id,
    p_request_id,
    p_organization_id,
    v_name,
    v_scopes
  )
  on conflict (actor_user_id, request_id) do nothing
  returning * into v_request;

  if not found then
    select creation_request.*
    into v_request
    from app.integration_client_requests as creation_request
    where creation_request.actor_user_id = v_actor_id
      and creation_request.request_id = p_request_id;
    if not found or v_request.client_id is null then
      raise exception using errcode = '55000', message = 'integration client request is incomplete';
    end if;
    if v_request.organization_id is distinct from p_organization_id
       or v_request.requested_name is distinct from v_name
       or v_request.requested_scopes is distinct from v_scopes then
      raise exception using errcode = '22023', message = 'p_request_id was already used for a different client';
    end if;
    select client.*
    into v_client
    from app.integration_clients as client
    where client.id = v_request.client_id
      and client.organization_id = p_organization_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'integration client not found';
    end if;
    return jsonb_build_object(
      'client', private.integration_client_public_json(v_client),
      'secret', null,
      'requestId', p_request_id,
      'replayed', true
    );
  end if;

  select count(*)
  into v_active_count
  from app.integration_clients as client
  where client.organization_id = p_organization_id
    and client.status = 'active';
  if v_active_count >= 20 then
    raise exception using errcode = '54000', message = 'an organization may have at most 20 active integration clients';
  end if;
  if exists (
    select 1
    from app.integration_clients as client
    where client.organization_id = p_organization_id
      and client.status = 'active'
      and lower(btrim(client.name)) = lower(v_name)
  ) then
    raise exception using errcode = '23505', message = 'an active integration client with this name already exists';
  end if;

  perform set_config('app.request_id', p_request_id::text, true);

  for v_attempt in 1..3 loop
    v_raw := encode(extensions.gen_random_bytes(24), 'hex');
    v_prefix := substr(v_raw, 1, 12);
    v_secret := 'mosaic_sk_' || v_raw;
    v_hash := encode(extensions.digest(convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
    begin
      insert into app.integration_clients (
        organization_id,
        name,
        key_prefix,
        secret_hash,
        scopes,
        status,
        created_by,
        updated_by
      ) values (
        p_organization_id,
        v_name,
        v_prefix,
        v_hash,
        v_scopes,
        'active',
        v_actor_id,
        v_actor_id
      )
      returning * into v_client;
      exit;
    exception
      when unique_violation then
        if v_attempt = 3 then
          raise;
        end if;
    end;
  end loop;

  update app.integration_client_requests as creation_request
  set
    client_id = v_client.id,
    completed_at = now()
  where creation_request.actor_user_id = v_actor_id
    and creation_request.request_id = p_request_id;

  perform private.record_integration_client_audit(
    p_organization_id,
    v_client.id,
    'insert',
    p_request_id,
    null,
    jsonb_build_object(
      'name', v_client.name,
      'keyPrefix', v_client.key_prefix,
      'scopes', to_jsonb(v_client.scopes),
      'status', v_client.status
    )
  );

  return jsonb_build_object(
    'client', private.integration_client_public_json(v_client),
    'secret', v_secret,
    'requestId', p_request_id,
    'replayed', false
  );
end;
$function$;

comment on function public.create_integration_client(uuid, text, text[], uuid) is $comment$
Arguments: organization, display name, scopes[], client request UUID.
Owners and admins may issue an integration client. The plaintext secret is
returned once; retries with the same request ID do not return it again.
workspace:read is required. Active clients are capped at 20 per organization.
$comment$;

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

comment on function public.list_integration_clients(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns {"clients":[{id,name,keyPrefix,scopes,status,createdAt,createdByName,revokedAt,lastUsedAt}]}.
Secrets are never included. Owner/admin only.
$comment$;

create or replace function public.revoke_integration_client(
  p_organization_id uuid,
  p_client_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_client app.integration_clients%rowtype;
  v_previous jsonb;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_client_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id, p_client_id, and p_request_id are required';
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
  into v_actor_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor_id
    and membership.status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select client.*
  into v_client
  from app.integration_clients as client
  where client.organization_id = p_organization_id
    and client.id = p_client_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'integration client not found';
  end if;
  if v_client.status = 'revoked' then
    return jsonb_build_object(
      'changed', false,
      'requestId', p_request_id,
      'client', private.integration_client_public_json(v_client)
    );
  end if;

  perform set_config('app.request_id', p_request_id::text, true);
  v_previous := jsonb_build_object(
    'name', v_client.name,
    'keyPrefix', v_client.key_prefix,
    'scopes', to_jsonb(v_client.scopes),
    'status', v_client.status
  );

  update app.integration_clients as client
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by = v_actor_id,
    updated_by = v_actor_id
  where client.id = v_client.id
  returning client.* into v_client;

  perform private.record_integration_client_audit(
    p_organization_id,
    v_client.id,
    'update',
    p_request_id,
    v_previous,
    jsonb_build_object(
      'name', v_client.name,
      'keyPrefix', v_client.key_prefix,
      'scopes', to_jsonb(v_client.scopes),
      'status', v_client.status,
      'revokedAt', v_client.revoked_at
    )
  );

  return jsonb_build_object(
    'changed', true,
    'requestId', p_request_id,
    'client', private.integration_client_public_json(v_client)
  );
end;
$function$;

comment on function public.revoke_integration_client(uuid, uuid, uuid) is $comment$
Arguments: organization, client id, request UUID.
Owners and admins may revoke. Retrying an already revoked client is a no-op.
$comment$;

create or replace function public.authorize_integration_request(p_secret text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_secret text := btrim(p_secret);
  v_prefix text;
  v_hash text;
  v_client app.integration_clients%rowtype;
  v_window_start timestamptz;
  v_count integer;
  v_retry integer;
begin
  if v_secret is null or v_secret !~ '^mosaic_sk_[0-9a-f]{48}$' then
    raise exception using errcode = '42501', message = 'invalid credential';
  end if;
  v_prefix := substr(v_secret, 11, 12);
  v_hash := encode(extensions.digest(convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');

  select client.*
  into v_client
  from app.integration_clients as client
  where client.key_prefix = v_prefix
  for update;
  if not found
     or v_client.status <> 'active'
     or v_client.secret_hash is distinct from v_hash then
    raise exception using errcode = '42501', message = 'invalid credential';
  end if;

  perform 1
  from app.organizations as organization
  where organization.id = v_client.organization_id
    and organization.archived_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'invalid credential';
  end if;

  v_window_start := date_trunc('minute', now());
  insert into app.integration_rate_windows (client_id, window_started_at, request_count)
  values (v_client.id, v_window_start, 0)
  on conflict (client_id, window_started_at) do nothing;

  select rate_window.request_count
  into v_count
  from app.integration_rate_windows as rate_window
  where rate_window.client_id = v_client.id
    and rate_window.window_started_at = v_window_start
  for update;

  if v_count >= 60 then
    v_retry := greatest(1, ceil(extract(epoch from (v_window_start + interval '1 minute' - now())))::integer);
    return jsonb_build_object(
      'allowed', false,
      'code', 'RATE_LIMITED',
      'retryAfterSeconds', v_retry,
      'remaining', 0
    );
  end if;

  update app.integration_rate_windows as rate_window
  set request_count = rate_window.request_count + 1
  where rate_window.client_id = v_client.id
    and rate_window.window_started_at = v_window_start
  returning rate_window.request_count into v_count;

  update app.integration_clients as client
  set last_used_at = now()
  where client.id = v_client.id;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(0, 60 - v_count),
    'client', jsonb_build_object(
      'id', v_client.id,
      'organizationId', v_client.organization_id,
      'name', v_client.name,
      'scopes', to_jsonb(v_client.scopes)
    )
  );
end;
$function$;

comment on function public.authorize_integration_request(text) is $comment$
Service-role only. Verifies a mosaic_sk_ credential, enforces the shared
60-requests-per-minute window, and returns organization + scopes for API/MCP
adapters. Does not execute workspace operations.
$comment$;

create or replace function public.list_audit_events(
  p_organization_id uuid,
  p_limit integer default 50,
  p_before bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer := coalesce(p_limit, 50);
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_limit < 1 or v_limit > 200 then
    raise exception using errcode = '22023', message = 'p_limit must be between 1 and 200';
  end if;

  with page as (
    select audit.*
    from app.audit_events as audit
    where audit.organization_id = p_organization_id
      and (p_before is null or audit.id < p_before)
    order by audit.id desc
    limit v_limit
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'occurredAt', page.occurred_at,
        'actorUserId', page.actor_user_id,
        'actorName', actor.display_name,
        'action', page.action,
        'entityType', page.entity_type,
        'entityId', page.entity_id,
        'entityKey', page.entity_key,
        'requestId', page.request_id,
        'workspaceRevision', page.workspace_revision,
        'oldData', page.old_data,
        'newData', page.new_data,
        'callerKind', page.caller_kind,
        'integrationClientId', page.integration_client_id,
        'integrationClientName', integration_client.name
      ) order by page.id desc
    ), '[]'::jsonb),
    'nextBefore', case when count(page.id) = v_limit then min(page.id) else null end
  )
  into v_result
  from page
  left join app.profiles as actor on actor.id = page.actor_user_id
  left join app.integration_clients as integration_client
    on integration_client.id = page.integration_client_id;

  return v_result;
end;
$function$;

comment on function public.list_audit_events(uuid, integer, bigint) is $comment$
Arguments: p_organization_id uuid, p_limit integer (1..200), p_before bigint cursor (exclusive).
Returns items with callerKind (user|ai|integration) and optional integration client identity.
Only owners and admins may read audit events. Secrets are never included.
$comment$;

revoke all on function private.allowed_integration_scopes() from public, anon, authenticated;
revoke all on function private.normalize_integration_scopes(text[]) from public, anon, authenticated;
revoke all on function private.integration_client_public_json(app.integration_clients, text) from public, anon, authenticated;
revoke all on function private.record_integration_client_audit(uuid, uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.audit_row_change() from public, anon, authenticated;
revoke all on function public.create_integration_client(uuid, text, text[], uuid) from public, anon, authenticated;
revoke all on function public.list_integration_clients(uuid) from public, anon, authenticated;
revoke all on function public.revoke_integration_client(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.authorize_integration_request(text) from public, anon, authenticated, service_role;
revoke all on function public.list_audit_events(uuid, integer, bigint) from public, anon, authenticated;

grant execute on function public.create_integration_client(uuid, text, text[], uuid) to authenticated;
grant execute on function public.list_integration_clients(uuid) to authenticated;
grant execute on function public.revoke_integration_client(uuid, uuid, uuid) to authenticated;
grant execute on function public.list_audit_events(uuid, integer, bigint) to authenticated;
grant execute on function public.authorize_integration_request(text) to service_role;

revoke all on table app.integration_clients from public, anon, authenticated, service_role;
revoke all on table app.integration_client_requests from public, anon, authenticated, service_role;
revoke all on table app.integration_rate_windows from public, anon, authenticated, service_role;

commit;
