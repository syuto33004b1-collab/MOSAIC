begin;

-- Approved outbound MCP servers. The AI secretary may only reach a server that
-- an owner or admin registered here, and only the tools listed on that row.
-- Outbound secrets are NOT stored: the Edge Function reads
-- MCP_SECRET_<SERVER_KEY uppercased> from its own environment, so the plaintext
-- credential never lives in the database.
create table app.mcp_servers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete restrict,
  server_key text not null check (server_key ~ '^[a-z][a-z0-9_]{0,15}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  url text not null check (
    char_length(url) between 12 and 2048
    and url like 'https://%'
  ),
  allowed_tools text[] not null check (
    cardinality(allowed_tools) between 1 and 8
  ),
  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index mcp_servers_org_active_key_idx
  on app.mcp_servers (organization_id, server_key)
  where status = 'active';
create index mcp_servers_org_status_idx
  on app.mcp_servers (organization_id, status, created_at desc);

-- One row per outbound call. Doubles as the per-minute rate window, so no
-- separate window table is needed. Argument values are never stored.
create table app.mcp_call_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  mcp_server_id uuid not null,
  server_key text not null,
  tool_name text not null check (char_length(btrim(tool_name)) between 1 and 40),
  actor_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  error_code text check (error_code is null or char_length(error_code) between 1 and 60),
  argument_bytes integer not null default 0 check (argument_bytes between 0 and 1048576),
  response_bytes integer not null default 0 check (response_bytes between 0 and 1048576),
  duration_ms integer not null default 0 check (duration_ms between 0 and 600000),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, mcp_server_id)
    references app.mcp_servers (organization_id, id)
    on delete cascade,
  check ((status = 'pending') = (completed_at is null))
);

create index mcp_call_logs_rate_idx
  on app.mcp_call_logs (organization_id, started_at desc);
create index mcp_call_logs_server_idx
  on app.mcp_call_logs (organization_id, mcp_server_id, started_at desc);

alter table app.mcp_servers enable row level security;
alter table app.mcp_servers force row level security;
alter table app.mcp_call_logs enable row level security;
alter table app.mcp_call_logs force row level security;

revoke all on table app.mcp_servers from public, anon, authenticated, service_role;
revoke all on table app.mcp_call_logs from public, anon, authenticated, service_role;

create trigger mcp_servers_touch
before insert or update on app.mcp_servers
for each row execute function private.touch_versioned_row();

create trigger mcp_servers_audit
after insert or update or delete on app.mcp_servers
for each row execute function private.audit_row_change();

create or replace function private.mcp_server_public_json(
  p_server app.mcp_servers,
  p_created_by_name text default null
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_server.id,
    'organizationId', p_server.organization_id,
    'serverKey', p_server.server_key,
    'name', p_server.name,
    'url', p_server.url,
    'allowedTools', to_jsonb(p_server.allowed_tools),
    'status', p_server.status,
    'createdAt', p_server.created_at,
    'createdByUserId', p_server.created_by,
    'createdByName', p_created_by_name,
    'revokedAt', p_server.revoked_at
  );
$function$;

-- Registration-time URL guard. The authoritative check runs again in the Edge
-- Function at call time, where DNS can be resolved.
create or replace function private.assert_public_https_mcp_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_authority text;
  v_host text;
begin
  if v_url !~ '^https://[^/?#]+' then
    raise exception using errcode = '22023', message = 'mcp server url must be an https address';
  end if;
  v_authority := split_part(substring(v_url from 9), '/', 1);
  if position('@' in v_authority) > 0 then
    raise exception using errcode = '22023', message = 'mcp server url must not embed credentials';
  end if;
  -- A bracketed authority is an IPv6 literal. split_part cannot take it apart,
  -- and an approved SaaS endpoint is always a hostname, so refuse it outright.
  if position('[' in v_authority) > 0 then
    raise exception using errcode = '22023', message = 'mcp server url must use a hostname, not an IP literal';
  end if;
  v_host := lower(split_part(v_authority, ':', 1));
  if v_host = '' or v_host = 'localhost'
     or v_host like '%.localhost'
     or v_host like '%.local'
     or v_host like '%.internal'
     or v_host = 'metadata.google.internal'
  then
    raise exception using errcode = '22023', message = 'mcp server url must not target a private or loopback host';
  end if;
  -- Only a full dotted-quad is range checked, so a hostname such as
  -- 10-a.example.com or fe8-api.example.com is not refused by accident.
  if v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
     and v_host ~ '^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)'
  then
    raise exception using errcode = '22023', message = 'mcp server url must not target a private or loopback host';
  end if;
  return v_url;
end;
$function$;

create or replace function private.normalize_mcp_tool_names(p_tools text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_tools text[];
begin
  select coalesce(array_agg(distinct entry.tool order by entry.tool), '{}'::text[])
  into v_tools
  from unnest(coalesce(p_tools, '{}'::text[])) as entry(tool)
  where btrim(coalesce(entry.tool, '')) <> ''
    and btrim(entry.tool) ~ '^[A-Za-z][A-Za-z0-9_.-]{0,39}$';

  if cardinality(v_tools) = 0 then
    raise exception using errcode = '22023', message = 'at least one allowed tool name is required';
  end if;
  if cardinality(v_tools) > 8 then
    raise exception using errcode = '22023', message = 'at most 8 tools may be approved per mcp server';
  end if;
  if cardinality(v_tools) <> cardinality(coalesce(p_tools, '{}'::text[])) then
    raise exception using errcode = '22023', message = 'allowed tool names must be unique, at most 40 characters, and use letters, digits, dot, dash, or underscore';
  end if;
  return v_tools;
end;
$function$;

create or replace function public.create_mcp_server(
  p_organization_id uuid,
  p_server_key text,
  p_name text,
  p_url text,
  p_allowed_tools text[],
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
  v_key text := lower(btrim(coalesce(p_server_key, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_url text;
  v_tools text[];
  v_server app.mcp_servers%rowtype;
  v_active_count integer;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id and p_request_id are required';
  end if;
  if v_key !~ '^[a-z][a-z0-9_]{0,15}$' then
    raise exception using errcode = '22023', message = 'server key must be 1 to 16 characters, starting with a lowercase letter, using lowercase letters, digits, or underscore';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'server name must contain 1 to 80 characters';
  end if;
  v_url := private.assert_public_https_mcp_url(p_url);
  v_tools := private.normalize_mcp_tool_names(p_allowed_tools);

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

  -- Re-registering the same key with identical values is a no-op, so a retried
  -- request does not fail. Any other difference is a conflict.
  select server.*
  into v_server
  from app.mcp_servers as server
  where server.organization_id = p_organization_id
    and server.server_key = v_key
    and server.status = 'active';
  if found then
    if v_server.url = v_url and v_server.allowed_tools = v_tools and v_server.name = v_name then
      return jsonb_build_object(
        'server', private.mcp_server_public_json(v_server),
        'requestId', p_request_id,
        'replayed', true
      );
    end if;
    raise exception using errcode = '23505', message = 'an active mcp server already uses this server key';
  end if;

  select count(*)
  into v_active_count
  from app.mcp_servers as server
  where server.organization_id = p_organization_id
    and server.status = 'active';
  if v_active_count >= 5 then
    raise exception using errcode = '54000', message = 'active mcp servers are limited to 5 per organization';
  end if;

  insert into app.mcp_servers (
    organization_id, server_key, name, url, allowed_tools, created_by, updated_by
  ) values (
    p_organization_id, v_key, v_name, v_url, v_tools, v_actor_id, v_actor_id
  )
  returning * into v_server;

  return jsonb_build_object(
    'server', private.mcp_server_public_json(v_server),
    'requestId', p_request_id,
    'replayed', false
  );
end;
$function$;

create or replace function public.revoke_mcp_server(
  p_organization_id uuid,
  p_server_id uuid,
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
  v_server app.mcp_servers%rowtype;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_server_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id, p_server_id, and p_request_id are required';
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

  select server.*
  into v_server
  from app.mcp_servers as server
  where server.organization_id = p_organization_id
    and server.id = p_server_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'mcp server not found';
  end if;
  if v_server.status = 'revoked' then
    return jsonb_build_object(
      'changed', false,
      'requestId', p_request_id,
      'server', private.mcp_server_public_json(v_server)
    );
  end if;

  update app.mcp_servers as server
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = v_actor_id
  where server.organization_id = p_organization_id
    and server.id = p_server_id
  returning * into v_server;

  return jsonb_build_object(
    'changed', true,
    'requestId', p_request_id,
    'server', private.mcp_server_public_json(v_server)
  );
end;
$function$;

create or replace function public.list_mcp_servers(p_organization_id uuid)
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
    'servers', coalesce(jsonb_agg(
      private.mcp_server_public_json(server, creator.display_name)
      order by server.created_at desc, server.id
    ), '[]'::jsonb)
  )
  into v_result
  from app.mcp_servers as server
  left join app.profiles as creator on creator.id = server.created_by
  where server.organization_id = p_organization_id;

  return v_result;
end;
$function$;

-- What the AI secretary may offer. Deliberately excludes the URL: the Edge
-- Function never chooses an address, begin_mcp_call hands it one.
create or replace function public.list_mcp_tools(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select jsonb_build_object(
    'servers', coalesce(jsonb_agg(
      jsonb_build_object(
        'serverKey', server.server_key,
        'name', server.name,
        'tools', to_jsonb(server.allowed_tools)
      ) order by server.server_key
    ), '[]'::jsonb)
  )
  into v_result
  from app.mcp_servers as server
  where server.organization_id = p_organization_id
    and server.status = 'active';

  return v_result;
end;
$function$;

-- Authorizes, rate limits, resolves the address, and opens the audit row in one
-- step. The caller names a server key and a tool; the URL comes from the row.
create or replace function public.begin_mcp_call(
  p_organization_id uuid,
  p_server_key text,
  p_tool_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_key text := lower(btrim(coalesce(p_server_key, '')));
  v_tool text := btrim(coalesce(p_tool_name, ''));
  v_server app.mcp_servers%rowtype;
  v_recent integer;
  v_call_id uuid;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select server.*
  into v_server
  from app.mcp_servers as server
  where server.organization_id = p_organization_id
    and server.server_key = v_key
    and server.status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'mcp server not found';
  end if;
  if not (v_tool = any (v_server.allowed_tools)) then
    raise exception using errcode = '42501', message = 'this tool is not approved for the mcp server';
  end if;

  select count(*)
  into v_recent
  from app.mcp_call_logs as call_log
  where call_log.organization_id = p_organization_id
    and call_log.started_at > now() - interval '1 minute';
  if v_recent >= 20 then
    raise exception using errcode = '54000', message = 'external mcp calls are limited to 20 per minute';
  end if;

  insert into app.mcp_call_logs (
    organization_id, mcp_server_id, server_key, tool_name, actor_user_id
  ) values (
    p_organization_id, v_server.id, v_server.server_key, v_tool, v_actor_id
  )
  returning id into v_call_id;

  return jsonb_build_object(
    'callId', v_call_id,
    'serverKey', v_server.server_key,
    'serverName', v_server.name,
    'toolName', v_tool,
    'url', v_server.url
  );
end;
$function$;

create or replace function public.complete_mcp_call(
  p_organization_id uuid,
  p_call_id uuid,
  p_ok boolean,
  p_error_code text,
  p_argument_bytes integer,
  p_response_bytes integer,
  p_duration_ms integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_updated integer;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  update app.mcp_call_logs as call_log
  set status = case when p_ok then 'ok' else 'error' end,
      error_code = case when p_ok then null else nullif(left(btrim(coalesce(p_error_code, '')), 60), '') end,
      argument_bytes = least(greatest(coalesce(p_argument_bytes, 0), 0), 1048576),
      response_bytes = least(greatest(coalesce(p_response_bytes, 0), 0), 1048576),
      duration_ms = least(greatest(coalesce(p_duration_ms, 0), 0), 600000),
      completed_at = now()
  where call_log.organization_id = p_organization_id
    and call_log.id = p_call_id
    and call_log.actor_user_id = v_actor_id
    and call_log.status = 'pending';
  get diagnostics v_updated = row_count;

  return jsonb_build_object('recorded', v_updated = 1);
end;
$function$;

comment on table app.mcp_servers is $comment$
External MCP servers an owner or admin approved for outbound use by the AI
secretary. Only the listed tools may be called. Outbound credentials are not
stored here: the chat Edge Function reads MCP_SECRET_<SERVER_KEY uppercased>
from its own environment, so no plaintext secret lives in the database.
$comment$;

comment on table app.mcp_call_logs is $comment$
One row per outbound MCP tool call: which server, which tool, who asked, whether
it succeeded, and how large the request and response were. Argument values are
never stored. Also serves as the per-minute rate window.
$comment$;

comment on function public.list_mcp_tools(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns {"servers":[{serverKey,name,tools:[...]}]} for active servers only.
Any active member may read it; the server address is deliberately excluded.
$comment$;

comment on function public.begin_mcp_call(uuid, text, text) is $comment$
Arguments: organization, server key, tool name.
Authorizes an active membership, rejects a tool the admin did not approve,
enforces 20 calls per minute per organization, opens an app.mcp_call_logs row,
and returns the approved URL. The caller never supplies an address.
$comment$;

comment on function public.complete_mcp_call(uuid, uuid, boolean, text, integer, integer, integer) is $comment$
Closes the audit row opened by begin_mcp_call. Only the actor who opened a
pending row may close it. Byte counts and durations are clamped, not trusted.
$comment$;

comment on function public.create_mcp_server(uuid, text, text, text[], uuid) is $comment$
Arguments: organization, server key, display name, https URL, approved tool
names, request UUID. Owners and admins only. Active servers are capped at 5 per
organization and 8 tools each. Private, loopback, and credential-bearing URLs
are rejected here and again in the Edge Function at call time. Re-registering an
active key with identical values returns that row instead of failing; any other
difference raises 23505. The request UUID is echoed back for client retries.
$comment$;

comment on function private.assert_public_https_mcp_url(text) is $comment$
Registration-time URL guard: https only, no embedded credentials, no loopback,
link-local, private, or *.local / *.internal host. The Edge Function repeats the
check with DNS resolution before every call.
$comment$;

revoke all on function private.mcp_server_public_json(app.mcp_servers, text) from public, anon, authenticated;
revoke all on function private.assert_public_https_mcp_url(text) from public, anon, authenticated;
revoke all on function private.normalize_mcp_tool_names(text[]) from public, anon, authenticated;
revoke all on function public.create_mcp_server(uuid, text, text, text[], uuid) from public, anon, authenticated;
revoke all on function public.revoke_mcp_server(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_mcp_servers(uuid) from public, anon, authenticated;
revoke all on function public.list_mcp_tools(uuid) from public, anon, authenticated;
revoke all on function public.begin_mcp_call(uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_mcp_call(uuid, uuid, boolean, text, integer, integer, integer) from public, anon, authenticated;

grant execute on function public.create_mcp_server(uuid, text, text, text[], uuid) to authenticated;
grant execute on function public.revoke_mcp_server(uuid, uuid, uuid) to authenticated;
grant execute on function public.list_mcp_servers(uuid) to authenticated;
grant execute on function public.list_mcp_tools(uuid) to authenticated;
grant execute on function public.begin_mcp_call(uuid, text, text) to authenticated;
grant execute on function public.complete_mcp_call(uuid, uuid, boolean, text, integer, integer, integer) to authenticated;

commit;
