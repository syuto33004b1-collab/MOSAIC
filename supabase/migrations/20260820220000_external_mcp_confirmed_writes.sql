begin;

-- Separates approved tools that change something outside MOSAIC from ones that
-- only read. MOSAIC cannot infer a tool's meaning, so an owner or admin declares
-- it. write_tools must stay inside the approved set.
alter table app.mcp_servers
  add column write_tools text[] not null default '{}'::text[];

alter table app.mcp_servers
  add constraint mcp_servers_write_tools_approved check (write_tools <@ allowed_tools);

alter table app.mcp_call_logs
  add column is_write boolean not null default false;

create index mcp_call_logs_pending_write_idx
  on app.mcp_call_logs (organization_id, actor_user_id, status)
  where status = 'pending' and is_write;

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
    'writeTools', to_jsonb(p_server.write_tools),
    'status', p_server.status,
    'createdAt', p_server.created_at,
    'createdByUserId', p_server.created_by,
    'createdByName', p_created_by_name,
    'revokedAt', p_server.revoked_at
  );
$function$;

create or replace function public.create_mcp_server(
  p_organization_id uuid,
  p_server_key text,
  p_name text,
  p_url text,
  p_allowed_tools text[],
  p_write_tools text[],
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
  v_write_tools text[];
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
  v_write_tools := case
    when coalesce(cardinality(p_write_tools), 0) = 0 then '{}'::text[]
    else private.normalize_mcp_tool_names(p_write_tools)
  end;
  if not (v_write_tools <@ v_tools) then
    raise exception using errcode = '22023', message = 'write tools must be part of the approved tools';
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

  -- Re-registering the same key with identical values is a no-op, so a retried
  -- request does not fail. Any other difference is a conflict.
  select server.*
  into v_server
  from app.mcp_servers as server
  where server.organization_id = p_organization_id
    and server.server_key = v_key
    and server.status = 'active';
  if found then
    if v_server.url = v_url and v_server.allowed_tools = v_tools and v_server.write_tools = v_write_tools and v_server.name = v_name then
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
    organization_id, server_key, name, url, allowed_tools, write_tools, created_by, updated_by
  ) values (
    p_organization_id, v_key, v_name, v_url, v_tools, v_write_tools, v_actor_id, v_actor_id
  )
  returning * into v_server;

  return jsonb_build_object(
    'server', private.mcp_server_public_json(v_server),
    'requestId', p_request_id,
    'replayed', false
  );
end;
$function$;

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
  -- An empty list keeps the tools out of the AI secretary's declarations, so the
  -- model never learns that an external server exists.
  if private.role_feature_disabled(p_organization_id, 'externalMcp') then
    return jsonb_build_object('servers', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'servers', coalesce(jsonb_agg(
      jsonb_build_object(
        'serverKey', server.server_key,
        'name', server.name,
        'tools', to_jsonb(server.allowed_tools),
        'writeTools', to_jsonb(server.write_tools)
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
  -- Refused before the address is resolved and before an audit row is opened: a
  -- permission decision is not an outbound call.
  if private.role_feature_disabled(p_organization_id, 'externalMcp') then
    raise exception using errcode = '42501', message = 'external mcp servers are disabled for this role';
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
  -- A tool that changes something outside MOSAIC must go through
  -- propose_mcp_call and an explicit confirmation instead.
  if v_tool = any (v_server.write_tools) then
    raise exception using errcode = '42501', message = 'this tool writes and needs an explicit confirmation';
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
    organization_id, mcp_server_id, server_key, tool_name, actor_user_id, is_write
  ) values (
    p_organization_id, v_server.id, v_server.server_key, v_tool, v_actor_id, false
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

-- Opens a write proposal. Nothing is sent outside MOSAIC here: the address is
-- withheld until resume_mcp_call, after the person confirms. The pending row is
-- both the audit record and the single-use guard against a replayed
-- confirmation.
create or replace function public.propose_mcp_call(
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
  if private.role_feature_disabled(p_organization_id, 'externalMcp') then
    raise exception using errcode = '42501', message = 'external mcp servers are disabled for this role';
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
  if not (v_tool = any (v_server.write_tools)) then
    raise exception using errcode = '42501', message = 'this tool is not approved for writing on the mcp server';
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
    organization_id, mcp_server_id, server_key, tool_name, actor_user_id, is_write
  ) values (
    p_organization_id, v_server.id, v_server.server_key, v_tool, v_actor_id, true
  )
  returning id into v_call_id;

  return jsonb_build_object(
    'callId', v_call_id,
    'serverKey', v_server.server_key,
    'serverName', v_server.name,
    'toolName', v_tool
  );
end;
$function$;

-- Hands out the approved address for a confirmed write, once. A replayed
-- confirmation finds no pending row and is refused.
create or replace function public.resume_mcp_call(
  p_organization_id uuid,
  p_call_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_call app.mcp_call_logs%rowtype;
  v_server app.mcp_servers%rowtype;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if private.role_feature_disabled(p_organization_id, 'externalMcp') then
    raise exception using errcode = '42501', message = 'external mcp servers are disabled for this role';
  end if;

  select call_log.*
  into v_call
  from app.mcp_call_logs as call_log
  where call_log.organization_id = p_organization_id
    and call_log.id = p_call_id
    and call_log.actor_user_id = v_actor_id
    and call_log.is_write
    and call_log.status = 'pending'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'no pending external write for this confirmation';
  end if;

  -- Re-read the registry: approval may have been withdrawn since the proposal.
  select server.*
  into v_server
  from app.mcp_servers as server
  where server.organization_id = p_organization_id
    and server.id = v_call.mcp_server_id
    and server.status = 'active';
  if not found or not (v_call.tool_name = any (v_server.write_tools)) then
    raise exception using errcode = '42501', message = 'this tool is no longer approved for writing on the mcp server';
  end if;

  return jsonb_build_object(
    'callId', v_call.id,
    'serverKey', v_server.server_key,
    'serverName', v_server.name,
    'toolName', v_call.tool_name,
    'url', v_server.url
  );
end;
$function$;

comment on function public.create_mcp_server(uuid, text, text, text, text[], text[], uuid) is $comment$
Arguments: organization, server key, display name, https URL, approved tool
names, approved write tool names, request UUID. Owners and admins only. Write
tools must be part of the approved tools. Active servers are capped at 5 per
organization and 8 tools each. Private, loopback, and credential-bearing URLs are
rejected here and again in the Edge Function at call time.
$comment$;

comment on function public.begin_mcp_call(uuid, text, text) is $comment$
Arguments: organization, server key, tool name.
The read path. Refuses a role whose permissions disable the externalMcp feature,
a tool the admin did not approve, and any tool declared as writing: those go
through propose_mcp_call and an explicit confirmation. Enforces 20 calls per
minute per organization and returns the approved URL.
$comment$;

comment on function public.propose_mcp_call(uuid, text, text) is $comment$
Arguments: organization, server key, write tool name.
Opens a pending app.mcp_call_logs row for a write that still needs confirmation
and deliberately does not return the address, so nothing leaves MOSAIC before a
person confirms. The pending row is also the single-use guard: only
resume_mcp_call can turn it into an executed call, and only once.
$comment$;

comment on function public.resume_mcp_call(uuid, uuid) is $comment$
Arguments: organization, call id from propose_mcp_call.
Returns the approved address for a confirmed write. Requires a pending write row
owned by the caller and re-checks that the tool is still approved for writing, so
a withdrawn approval stops a stale confirmation. A replayed confirmation finds no
pending row and raises P0002.
$comment$;

comment on function public.list_mcp_tools(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns {"servers":[{serverKey,name,tools:[...],writeTools:[...]}]} for active
servers only, or an empty list when the caller's role disables the externalMcp
feature. Any active member may read it; the server address is deliberately
excluded.
$comment$;

drop function if exists public.create_mcp_server(uuid, text, text, text, text[], uuid);

revoke all on function private.mcp_server_public_json(app.mcp_servers, text) from public, anon, authenticated;
revoke all on function public.create_mcp_server(uuid, text, text, text, text[], text[], uuid) from public, anon, authenticated;
revoke all on function public.list_mcp_tools(uuid) from public, anon, authenticated;
revoke all on function public.begin_mcp_call(uuid, text, text) from public, anon, authenticated;
revoke all on function public.propose_mcp_call(uuid, text, text) from public, anon, authenticated;
revoke all on function public.resume_mcp_call(uuid, uuid) from public, anon, authenticated;

grant execute on function public.create_mcp_server(uuid, text, text, text, text[], text[], uuid) to authenticated;
grant execute on function public.list_mcp_tools(uuid) to authenticated;
grant execute on function public.begin_mcp_call(uuid, text, text) to authenticated;
grant execute on function public.propose_mcp_call(uuid, text, text) to authenticated;
grant execute on function public.resume_mcp_call(uuid, uuid) to authenticated;

commit;
