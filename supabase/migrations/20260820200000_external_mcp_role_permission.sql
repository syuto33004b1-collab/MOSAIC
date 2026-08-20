begin;

-- Adds externalMcp as the sixth restrictable feature. Consulting an external MCP
-- server was the one capability role permissions could not switch off, so a role
-- restricted to its own data could still pull data in from outside.
alter table app.role_permissions
  drop constraint role_permissions_disabled_features_allowed;

alter table app.role_permissions
  add constraint role_permissions_disabled_features_allowed check (
    disabled_features <@ array[
      'searchScenes',
      'savedReports',
      'profileRequests',
      'opportunities',
      'favorites',
      'externalMcp'
    ]::text[]
  );

create or replace function private.apply_role_permissions(
  p_organization_id uuid,
  p_payload jsonb,
  p_actor_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_role text;
  v_scope text;
  v_hidden text[];
  v_readonly text[];
  v_disabled text[];
begin
  if not (p_payload ? 'rolePermissions') then
    return;
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'only owners and admins may change role permissions';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(private.payload_array(p_payload, array['rolePermissions', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'rolePermissions.upsert items must be JSON objects';
    end if;
    if (
      v_item - array[
        'role',
        'personScope',
        'hiddenFieldKeys',
        'readonlyFieldKeys',
        'disabledFeatures'
      ]::text[]
    ) <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'rolePermissions.upsert contains unsupported keys';
    end if;

    v_role := btrim(coalesce(v_item ->> 'role', ''));
    if v_role not in ('admin', 'planner', 'viewer') then
      raise exception using errcode = '22023', message = 'rolePermissions.role must be admin, planner, or viewer';
    end if;
    -- A restricted administrator must not be able to lift its own restrictions.
    if v_role = 'admin' and not private.has_org_role(p_organization_id, array['owner']::text[]) then
      raise exception using errcode = '42501', message = 'only owners may change administrator permissions';
    end if;

    v_scope := coalesce(nullif(btrim(coalesce(v_item ->> 'personScope', '')), ''), 'organization');
    if v_scope not in ('organization', 'unit_subtree', 'unit', 'self') then
      raise exception using errcode = '22023', message = 'rolePermissions.personScope is not supported';
    end if;

    v_hidden := private.role_permission_keys(v_item, 'hiddenFieldKeys');
    v_readonly := private.role_permission_keys(v_item, 'readonlyFieldKeys');
    v_disabled := private.role_permission_keys(v_item, 'disabledFeatures');

    if v_hidden && v_readonly then
      raise exception using errcode = '22023', message = 'a field key cannot be both hidden and read-only';
    end if;
    if not (
      v_disabled <@ array[
        'searchScenes',
        'savedReports',
        'profileRequests',
        'opportunities',
        'favorites',
        'externalMcp'
      ]::text[]
    ) then
      raise exception using errcode = '22023', message = 'rolePermissions.disabledFeatures contains an unsupported feature';
    end if;
    if exists (
      select 1
      from unnest(v_hidden || v_readonly) as entry(key)
      where not exists (
        select 1
        from app.custom_fields as field
        where field.organization_id = p_organization_id
          and field.field_key = entry.key
      )
    ) then
      raise exception using errcode = 'P0002', message = 'rolePermissions references an unknown custom field key';
    end if;

    insert into app.role_permissions as target (
      organization_id,
      role,
      person_scope,
      hidden_field_keys,
      readonly_field_keys,
      disabled_features,
      created_by,
      updated_by
    ) values (
      p_organization_id,
      v_role,
      v_scope,
      v_hidden,
      v_readonly,
      v_disabled,
      p_actor_id,
      p_actor_id
    )
    on conflict (organization_id, role) do update
      set person_scope = excluded.person_scope,
          hidden_field_keys = excluded.hidden_field_keys,
          readonly_field_keys = excluded.readonly_field_keys,
          disabled_features = excluded.disabled_features,
          updated_by = excluded.updated_by
      where target.person_scope is distinct from excluded.person_scope
         or target.hidden_field_keys is distinct from excluded.hidden_field_keys
         or target.readonly_field_keys is distinct from excluded.readonly_field_keys
         or target.disabled_features is distinct from excluded.disabled_features;
  end loop;
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

comment on function public.list_mcp_tools(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns {"servers":[{serverKey,name,tools:[...]}]} for active servers only, or an
empty list when the caller's role disables the externalMcp feature. Any active
member may read it; the server address is deliberately excluded.
$comment$;

comment on function public.begin_mcp_call(uuid, text, text) is $comment$
Arguments: organization, server key, tool name.
Authorizes an active membership, refuses a role whose permissions disable the
externalMcp feature, rejects a tool the admin did not approve, enforces 20 calls
per minute per organization, opens an app.mcp_call_logs row, and returns the
approved URL. A permission refusal happens before the audit row is opened.
$comment$;

revoke all on function private.apply_role_permissions(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.list_mcp_tools(uuid) from public, anon, authenticated;
revoke all on function public.begin_mcp_call(uuid, text, text) from public, anon, authenticated;

grant execute on function public.list_mcp_tools(uuid) to authenticated;
grant execute on function public.begin_mcp_call(uuid, text, text) to authenticated;

commit;
