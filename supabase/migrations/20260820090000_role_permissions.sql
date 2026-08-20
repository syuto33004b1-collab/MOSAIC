begin;

-- Role-scoped permissions on top of the four organization roles.
-- Owner is always unrestricted and never has a row here. A missing row means
-- "unrestricted", so existing organizations keep their current behaviour until
-- an owner configures a role.
create table app.role_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  role text not null check (role in ('admin', 'planner', 'viewer')),
  person_scope text not null default 'organization' check (
    person_scope in ('organization', 'unit_subtree', 'unit', 'self')
  ),
  -- Array membership, overlap, and null-element checks live in
  -- private.apply_role_permissions instead of here: the array operators
  -- (&&, <@, array_position) are STABLE, and a CHECK constraint requires
  -- IMMUTABLE. The apply function is the only writer, and the table is revoked
  -- from every role, so the function is the boundary.
  hidden_field_keys text[] not null default '{}'::text[] check (cardinality(hidden_field_keys) <= 100),
  readonly_field_keys text[] not null default '{}'::text[] check (cardinality(readonly_field_keys) <= 100),
  disabled_features text[] not null default '{}'::text[] check (cardinality(disabled_features) <= 20),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  unique (organization_id, role)
);

alter table app.role_permissions enable row level security;
alter table app.role_permissions force row level security;

revoke all on table app.role_permissions from public, anon, authenticated, service_role;

create trigger role_permissions_touch
before insert or update on app.role_permissions
for each row execute function private.touch_versioned_row();

create trigger role_permissions_audit
after insert or update or delete on app.role_permissions
for each row execute function private.audit_row_change();

-- People the caller may see under a non-organization data scope.
-- The unit walk is capped at the same depth as the org-unit cycle guard.
create or replace function private.visible_person_ids(
  p_organization_id uuid,
  p_scope text,
  p_user_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  with recursive own_person as (
    select person.id
    from app.people as person
    where person.organization_id = p_organization_id
      and person.user_id = p_user_id
  ),
  primary_unit as (
    select membership.org_unit_id
    from app.person_org_units as membership
    join own_person
      on own_person.id = membership.person_id
    where membership.organization_id = p_organization_id
      and membership.is_primary
  ),
  unit_tree as (
    select primary_unit.org_unit_id as id, 1 as depth
    from primary_unit
    union all
    select child.id, unit_tree.depth + 1
    from unit_tree
    join app.org_units as child
      on child.organization_id = p_organization_id
     and child.parent_id = unit_tree.id
    where unit_tree.depth < 16
  )
  select coalesce(array_agg(distinct visible.person_id), '{}'::uuid[])
  from (
    select own_person.id as person_id
    from own_person
    union
    select membership.person_id
    from app.person_org_units as membership
    where p_scope = 'unit'
      and membership.organization_id = p_organization_id
      and membership.org_unit_id in (select primary_unit.org_unit_id from primary_unit)
    union
    select membership.person_id
    from app.person_org_units as membership
    where p_scope = 'unit_subtree'
      and membership.organization_id = p_organization_id
      and membership.org_unit_id in (select unit_tree.id from unit_tree)
  ) as visible;
$function$;

create or replace function private.role_feature_disabled(
  p_organization_id uuid,
  p_feature text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from app.organization_memberships as membership
    join app.role_permissions as permission
      on permission.organization_id = membership.organization_id
     and permission.role = membership.role
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and p_feature = any (permission.disabled_features)
  );
$function$;

-- Custom fields the caller may not write: hidden plus read-only for its role.
create or replace function private.locked_custom_field_ids(p_organization_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(field.id::text), '{}'::text[])
  from app.organization_memberships as membership
  join app.role_permissions as permission
    on permission.organization_id = membership.organization_id
   and permission.role = membership.role
  join app.custom_fields as field
    on field.organization_id = permission.organization_id
   and (
     field.field_key = any (permission.hidden_field_keys)
     or field.field_key = any (permission.readonly_field_keys)
   )
  where membership.organization_id = p_organization_id
    and membership.user_id = auth.uid()
    and membership.status = 'active';
$function$;

-- Same as before, except a field the caller may not write keeps its stored value
-- instead of being dropped by the per-entity replace, and cannot be set.
create or replace function private.apply_custom_values(
  p_organization_id uuid,
  p_payload jsonb,
  p_actor_user_id uuid,
  p_collection text,
  p_entity_type text
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_pair record;
  v_id uuid;
  v_field app.custom_fields%rowtype;
  v_value text;
  v_locked text[] := private.locked_custom_field_ids(p_organization_id);
begin
  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array[p_collection, 'upsert']::text[]))
  loop
    if not (v_item ? 'customValues') then
      continue;
    end if;
    if jsonb_typeof(v_item -> 'customValues') <> 'object' then
      raise exception using errcode = '22023', message = 'customValues must be a JSON object';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    delete from app.custom_field_values as field_value
    using app.custom_fields as field
    where field_value.organization_id = p_organization_id
      and field_value.entity_id = v_id
      and field.organization_id = field_value.organization_id
      and field.id = field_value.field_id
      and field.entity_type = p_entity_type
      and not (field_value.field_id::text = any (v_locked));

    for v_pair in
      select key, value
      from jsonb_each_text(v_item -> 'customValues')
    loop
      v_value := btrim(v_pair.value);
      if v_value = '' then
        continue;
      end if;
      if v_pair.key = any (v_locked) then
        raise exception using errcode = '42501', message = 'a restricted custom field cannot be changed by this role';
      end if;
      select *
      into v_field
      from app.custom_fields as field
      where field.organization_id = p_organization_id
        and field.id = v_pair.key::uuid
        and field.entity_type = p_entity_type;
      if not found then
        raise exception using errcode = '22023', message = 'customValues contains an unknown field id';
      end if;
      insert into app.custom_field_values (
        organization_id, field_id, entity_id, value_text, created_by
      ) values (
        p_organization_id, v_field.id, v_id, v_value, p_actor_user_id
      );
    end loop;

    if exists (
      select 1
      from app.custom_fields as field
      where field.organization_id = p_organization_id
        and field.entity_type = p_entity_type
        and field.required
        and not exists (
          select 1
          from app.custom_field_values as field_value
          where field_value.organization_id = field.organization_id
            and field_value.field_id = field.id
            and field_value.entity_id = v_id
        )
    ) then
      raise exception using errcode = '22023', message = 'required custom fields must have a value';
    end if;
  end loop;
end;
$function$;

-- Applies the caller's role permissions to a finished workspace snapshot.
-- ponytail: trims the assembled snapshot instead of threading the rules through
-- every section of get_workspace. Move the filters into the query if snapshot
-- size ever becomes the bottleneck.
create or replace function private.scoped_workspace(
  p_organization_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_scope text := 'organization';
  v_hidden text[] := '{}'::text[];
  v_readonly text[] := '{}'::text[];
  v_disabled text[] := '{}'::text[];
  v_hidden_ids text[] := '{}'::text[];
  v_visible uuid[];
  v_result jsonb := p_snapshot;
begin
  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';
  if v_role is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  if v_role <> 'owner' then
    select
      permission.person_scope,
      permission.hidden_field_keys,
      permission.readonly_field_keys,
      permission.disabled_features
    into v_scope, v_hidden, v_readonly, v_disabled
    from app.role_permissions as permission
    where permission.organization_id = p_organization_id
      and permission.role = v_role;
    if not found then
      v_scope := 'organization';
      v_hidden := '{}'::text[];
      v_readonly := '{}'::text[];
      v_disabled := '{}'::text[];
    end if;
  end if;

  -- Disabled features keep their key and become empty so client shapes stay stable.
  if 'searchScenes' = any (v_disabled) then
    v_result := jsonb_set(v_result, array['searchScenes'], '[]'::jsonb);
  end if;
  if 'savedReports' = any (v_disabled) then
    v_result := jsonb_set(v_result, array['savedReports'], '[]'::jsonb);
  end if;
  if 'profileRequests' = any (v_disabled) then
    v_result := jsonb_set(v_result, array['profileRequests'], '[]'::jsonb);
  end if;
  if 'opportunities' = any (v_disabled) then
    v_result := jsonb_set(v_result, array['opportunities'], '[]'::jsonb);
    v_result := jsonb_set(v_result, array['opportunityNeeds'], '[]'::jsonb);
  end if;

  if coalesce(array_length(v_hidden, 1), 0) > 0 then
    select coalesce(array_agg(field.id::text), '{}'::text[])
    into v_hidden_ids
    from app.custom_fields as field
    where field.organization_id = p_organization_id
      and field.field_key = any (v_hidden);
  end if;

  v_result := jsonb_set(v_result, array['customFields'], coalesce((
    select jsonb_agg(
      entry.field || jsonb_build_object('canEdit', not (entry.field ->> 'key' = any (v_readonly)))
      order by entry.idx
    )
    from jsonb_array_elements(v_result -> 'customFields') with ordinality as entry(field, idx)
    where not (entry.field ->> 'key' = any (v_hidden))
  ), '[]'::jsonb));

  if coalesce(array_length(v_hidden_ids, 1), 0) > 0 then
    v_result := jsonb_set(v_result, array['members'], coalesce((
      select jsonb_agg(
        jsonb_set(entry.member, array['customValues'], (entry.member -> 'customValues') - v_hidden_ids)
        order by entry.idx
      )
      from jsonb_array_elements(v_result -> 'members') with ordinality as entry(member, idx)
    ), '[]'::jsonb));
    v_result := jsonb_set(v_result, array['projects'], coalesce((
      select jsonb_agg(
        jsonb_set(entry.project, array['customValues'], (entry.project -> 'customValues') - v_hidden_ids)
        order by entry.idx
      )
      from jsonb_array_elements(v_result -> 'projects') with ordinality as entry(project, idx)
    ), '[]'::jsonb));
  end if;

  if v_scope <> 'organization' then
    v_visible := private.visible_person_ids(p_organization_id, v_scope, v_user_id);

    v_result := jsonb_set(v_result, array['members'], coalesce((
      select jsonb_agg(entry.member order by entry.idx)
      from jsonb_array_elements(v_result -> 'members') with ordinality as entry(member, idx)
      where (entry.member ->> 'id')::uuid = any (v_visible)
    ), '[]'::jsonb));

    v_result := jsonb_set(v_result, array['orgMemberships'], coalesce((
      select jsonb_agg(entry.membership order by entry.idx)
      from jsonb_array_elements(v_result -> 'orgMemberships') with ordinality as entry(membership, idx)
      where (entry.membership ->> 'personId')::uuid = any (v_visible)
    ), '[]'::jsonb));

    v_result := jsonb_set(v_result, array['assignments'], coalesce((
      select jsonb_agg(entry.assignment order by entry.idx)
      from jsonb_array_elements(v_result -> 'assignments') with ordinality as entry(assignment, idx)
      where (entry.assignment ->> 'personId')::uuid = any (v_visible)
    ), '[]'::jsonb));

    v_result := jsonb_set(v_result, array['profileRequests'], coalesce((
      select jsonb_agg(entry.request order by entry.idx)
      from jsonb_array_elements(v_result -> 'profileRequests') with ordinality as entry(request, idx)
      where (entry.request ->> 'personId')::uuid = any (v_visible)
    ), '[]'::jsonb));

    v_result := jsonb_set(v_result, array['needs'], coalesce((
      select jsonb_agg(
        case
          when entry.need ->> 'draftPersonId' is null then entry.need
          when (entry.need ->> 'draftPersonId')::uuid = any (v_visible) then entry.need
          else jsonb_set(entry.need, array['draftPersonId'], 'null'::jsonb)
        end
        order by entry.idx
      )
      from jsonb_array_elements(v_result -> 'needs') with ordinality as entry(need, idx)
    ), '[]'::jsonb));

    v_result := jsonb_set(v_result, array['projects'], coalesce((
      select jsonb_agg(
        case
          when entry.project ->> 'ownerPersonId' is null then entry.project
          when (entry.project ->> 'ownerPersonId')::uuid = any (v_visible) then entry.project
          else entry.project || jsonb_build_object(
            'ownerPersonId', null,
            'ownerName', null,
            'ownerInitials', null
          )
        end
        order by entry.idx
      )
      from jsonb_array_elements(v_result -> 'projects') with ordinality as entry(project, idx)
    ), '[]'::jsonb));

    v_result := jsonb_set(v_result, array['opportunities'], coalesce((
      select jsonb_agg(
        case
          when entry.opportunity ->> 'ownerPersonId' is null then entry.opportunity
          when (entry.opportunity ->> 'ownerPersonId')::uuid = any (v_visible) then entry.opportunity
          else entry.opportunity || jsonb_build_object(
            'ownerPersonId', null,
            'ownerName', null,
            'ownerInitials', null
          )
        end
        order by entry.idx
      )
      from jsonb_array_elements(v_result -> 'opportunities') with ordinality as entry(opportunity, idx)
    ), '[]'::jsonb));
  end if;

  -- Only the roles that may edit the configuration get to read it back.
  return v_result || jsonb_build_object(
    'permissions', jsonb_build_object(
      'role', v_role,
      'personScope', v_scope,
      'hiddenFieldKeys', to_jsonb(v_hidden),
      'readonlyFieldKeys', to_jsonb(v_readonly),
      'disabledFeatures', to_jsonb(v_disabled)
    ),
    'rolePermissions', case
      when v_role in ('owner', 'admin') then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'role', permission.role,
            'personScope', permission.person_scope,
            'hiddenFieldKeys', to_jsonb(permission.hidden_field_keys),
            'readonlyFieldKeys', to_jsonb(permission.readonly_field_keys),
            'disabledFeatures', to_jsonb(permission.disabled_features)
          ) order by permission.role
        )
        from app.role_permissions as permission
        where permission.organization_id = p_organization_id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  );
end;
$function$;

-- Write-side counterpart of scoped_workspace. Only the three new axes are
-- checked here; the existing role/section rules stay where they already live.
create or replace function private.assert_role_permissions_allow(
  p_organization_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_scope text;
  v_disabled text[];
  v_visible uuid[];
begin
  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';
  if v_role is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_role = 'owner' then
    return;
  end if;

  select permission.person_scope, permission.disabled_features
  into v_scope, v_disabled
  from app.role_permissions as permission
  where permission.organization_id = p_organization_id
    and permission.role = v_role;
  if not found then
    return;
  end if;

  if p_payload ? 'searchScenes' and 'searchScenes' = any (v_disabled) then
    raise exception using errcode = '42501', message = 'search scenes are disabled for this role';
  end if;
  if p_payload ? 'savedReports' and 'savedReports' = any (v_disabled) then
    raise exception using errcode = '42501', message = 'saved reports are disabled for this role';
  end if;
  if p_payload ? 'profileRequests' and 'profileRequests' = any (v_disabled) then
    raise exception using errcode = '42501', message = 'profile requests are disabled for this role';
  end if;
  if (p_payload ? 'opportunities' or p_payload ? 'opportunityNeeds')
     and 'opportunities' = any (v_disabled) then
    raise exception using errcode = '42501', message = 'pre-award opportunities are disabled for this role';
  end if;

  if v_scope <> 'organization' then
    v_visible := private.visible_person_ids(p_organization_id, v_scope, v_user_id);

    if exists (
      select 1
      from jsonb_array_elements(
        private.payload_array(p_payload, array['assignments', 'upsert']::text[])
      ) as entry(item)
      where entry.item ->> 'personId' is not null
        and entry.item ->> 'personId' not in (select visible.id::text from unnest(v_visible) as visible(id))
    ) then
      raise exception using errcode = '42501', message = 'this role cannot assign a member outside its data scope';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(
        private.payload_array(p_payload, array['needs', 'upsert']::text[])
      ) as entry(item)
      where entry.item ->> 'draftPersonId' is not null
        and entry.item ->> 'draftPersonId' not in (select visible.id::text from unnest(v_visible) as visible(id))
    ) then
      raise exception using errcode = '42501', message = 'this role cannot draft a member outside its data scope';
    end if;

    if exists (
      select 1
      from app.people as person
      where person.organization_id = p_organization_id
        and not (person.id = any (v_visible))
        and person.id::text in (
          select entry.item ->> 'id'
          from jsonb_array_elements(
            private.payload_array(p_payload, array['members', 'upsert']::text[])
          ) as entry(item)
          where entry.item ->> 'id' is not null
        )
    ) then
      raise exception using errcode = '42501', message = 'this role cannot change a member outside its data scope';
    end if;
  end if;
end;
$function$;

create or replace function private.role_permission_keys(p_item jsonb, p_key text)
returns text[]
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_value jsonb;
  v_keys text[] := '{}'::text[];
begin
  for v_value in
    select value from jsonb_array_elements(private.payload_array(p_item, array[p_key]))
  loop
    if jsonb_typeof(v_value) <> 'string' then
      raise exception using errcode = '22023', message = p_key || ' must contain only strings';
    end if;
    v_keys := v_keys || btrim(v_value #>> '{}');
  end loop;

  select coalesce(array_agg(distinct entry.key order by entry.key), '{}'::text[])
  into v_keys
  from unnest(v_keys) as entry(key)
  where entry.key <> '';

  return v_keys;
end;
$function$;

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
        'favorites'
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

create or replace function private.workspace_core_payload(p_payload jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'p_payload must be a JSON object';
  end if;
  if (p_payload - array['members', 'projects', 'assignments', 'needs', 'skillCatalog', 'customFields', 'orgUnits', 'orgMemberships', 'opportunities', 'opportunityNeeds', 'searchScenes', 'savedReports', 'profileRequests', 'rolePermissions']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'p_payload contains unsupported top-level keys';
  end if;
  if p_payload ? 'skillCatalog' and jsonb_typeof(p_payload -> 'skillCatalog') <> 'object' then
    raise exception using errcode = '22023', message = 'skillCatalog must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'skillCatalog', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'skillCatalog contains unsupported keys';
  end if;
  if p_payload ? 'customFields' and jsonb_typeof(p_payload -> 'customFields') <> 'object' then
    raise exception using errcode = '22023', message = 'customFields must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'customFields', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'customFields contains unsupported keys';
  end if;
  if p_payload ? 'orgUnits' and jsonb_typeof(p_payload -> 'orgUnits') <> 'object' then
    raise exception using errcode = '22023', message = 'orgUnits must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'orgUnits', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'orgUnits contains unsupported keys';
  end if;
  if p_payload ? 'orgMemberships' and jsonb_typeof(p_payload -> 'orgMemberships') <> 'object' then
    raise exception using errcode = '22023', message = 'orgMemberships must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'orgMemberships', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'orgMemberships contains unsupported keys';
  end if;
  if p_payload ? 'opportunities' and jsonb_typeof(p_payload -> 'opportunities') <> 'object' then
    raise exception using errcode = '22023', message = 'opportunities must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'opportunities', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'opportunities contains unsupported keys';
  end if;
  if p_payload ? 'opportunityNeeds' and jsonb_typeof(p_payload -> 'opportunityNeeds') <> 'object' then
    raise exception using errcode = '22023', message = 'opportunityNeeds must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'opportunityNeeds', '{}'::jsonb) - array['upsert', 'cancelIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'opportunityNeeds contains unsupported keys';
  end if;
  if p_payload ? 'searchScenes' and jsonb_typeof(p_payload -> 'searchScenes') <> 'object' then
    raise exception using errcode = '22023', message = 'searchScenes must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'searchScenes', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'searchScenes contains unsupported keys';
  end if;
  if p_payload ? 'savedReports' and jsonb_typeof(p_payload -> 'savedReports') <> 'object' then
    raise exception using errcode = '22023', message = 'savedReports must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'savedReports', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'savedReports contains unsupported keys';
  end if;
  if p_payload ? 'profileRequests' and jsonb_typeof(p_payload -> 'profileRequests') <> 'object' then
    raise exception using errcode = '22023', message = 'profileRequests must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'profileRequests', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'profileRequests contains unsupported keys';
  end if;
  if p_payload ? 'rolePermissions' and jsonb_typeof(p_payload -> 'rolePermissions') <> 'object' then
    raise exception using errcode = '22023', message = 'rolePermissions must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'rolePermissions', '{}'::jsonb) - array['upsert']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'rolePermissions contains unsupported keys';
  end if;
  return p_payload - 'skillCatalog' - 'customFields' - 'orgUnits' - 'orgMemberships' - 'opportunities' - 'opportunityNeeds' - 'searchScenes' - 'savedReports' - 'profileRequests' - 'rolePermissions';
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
  -- Role permissions are never writable through an integration, at any scope.
  if p_payload ? 'rolePermissions' then
    raise exception using errcode = '42501', message = 'rolePermissions cannot be changed through an integration';
  end if;
  if (
        p_payload ? 'members'
        or p_payload ? 'skillCatalog'
        or p_payload ? 'customFields'
        or p_payload ? 'orgUnits'
        or p_payload ? 'orgMemberships'
        or p_payload ? 'searchScenes'
        or p_payload ? 'savedReports'
        or p_payload ? 'profileRequests'
      )
     and not ('members:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'members:write is required';
  end if;
  if (p_payload ? 'projects' or p_payload ? 'opportunities')
     and not ('projects:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'projects:write is required';
  end if;
  if p_payload ? 'assignments' and not ('assignments:write' = any (p_client.scopes) or 'staffing:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'assignments:write is required';
  end if;
  if (p_payload ? 'needs' or p_payload ? 'opportunityNeeds')
     and not ('staffing:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'staffing:write is required';
  end if;
end;
$function$;

create or replace function public.save_workspace(
  p_organization_id uuid,
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
  v_core jsonb;
  v_core_hash text;
  v_result jsonb;
begin
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'p_payload_hash must be lowercase SHA-256 hex';
  end if;

  -- Field, feature, and data-scope limits. Evaluated against the rules in force
  -- when the request arrived, before apply_role_permissions can change them.
  perform private.assert_role_permissions_allow(p_organization_id, p_payload);

  v_core := private.workspace_core_payload(p_payload);
  v_core_hash := encode(extensions.digest(convert_to(v_core::text, 'UTF8'), 'sha256'), 'hex');
  v_result := private.save_workspace_core(
    p_organization_id,
    p_expected_revision,
    p_request_id,
    v_core,
    v_core_hash
  );

  if coalesce((v_result ->> 'replayed')::boolean, false) then
    return v_result;
  end if;

  perform private.apply_skill_catalog(p_organization_id, p_payload, auth.uid());
  perform private.apply_skill_levels(p_organization_id, p_payload);
  perform private.apply_custom_fields(p_organization_id, p_payload, auth.uid());
  perform private.apply_role_permissions(p_organization_id, p_payload, auth.uid());
  perform private.apply_custom_values(p_organization_id, p_payload, auth.uid(), 'members', 'member');
  perform private.apply_custom_values(p_organization_id, p_payload, auth.uid(), 'projects', 'project');
  perform private.apply_work_history(p_organization_id, p_payload, auth.uid());
  perform private.apply_org_units(p_organization_id, p_payload, auth.uid());
  perform private.apply_org_memberships(p_organization_id, p_payload, auth.uid());
  perform private.apply_org_unit_archives(p_organization_id, p_payload);
  perform private.sync_people_departments_from_org(p_organization_id, auth.uid());
  perform private.apply_search_scenes(p_organization_id, p_payload, auth.uid());
  perform private.apply_saved_reports(p_organization_id, p_payload, auth.uid());
  perform private.apply_profile_requests(p_organization_id, p_payload, auth.uid());
  perform private.apply_opportunities(p_organization_id, p_payload, auth.uid());
  perform private.apply_opportunity_needs(p_organization_id, p_payload, auth.uid());
  perform private.assert_skill_proficiency_matches(p_organization_id);
  return v_result;
end;
$function$;

create or replace function public.get_workspace(p_organization_id uuid)
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
    'organization', jsonb_build_object(
      'id', organization.id,
      'name', organization.name,
      'slug', organization.slug,
      'workspaceRevision', organization.workspace_revision,
      'workspaceChangedAt', organization.workspace_changed_at,
      'workspaceChangedBy', organization.workspace_changed_by
    ),
    'skillCatalog', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', skill.id,
          'name', skill.name,
          'kind', skill.kind,
          'parentId', skill.parent_id,
          'sortOrder', skill.sort_order
        ) order by skill.sort_order, skill.normalized_name, skill.id
      )
      from app.skills as skill
      where skill.organization_id = organization.id
    ), '[]'::jsonb),
    'customFields', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', field.id,
          'entityType', field.entity_type,
          'key', field.field_key,
          'label', field.label,
          'fieldType', field.field_type,
          'required', field.required,
          'options', field.options,
          'showInList', field.show_in_list,
          'showInDetail', field.show_in_detail,
          'searchable', field.searchable,
          'sortOrder', field.sort_order
        ) order by field.entity_type, field.sort_order, field.label, field.id
      )
      from app.custom_fields as field
      where field.organization_id = organization.id
    ), '[]'::jsonb),
    'searchScenes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', scene.id,
          'name', scene.name,
          'query', nullif(scene.query_text, ''),
          'role', nullif(scene.role_title, ''),
          'location', nullif(scene.location, ''),
          'skills', scene.skills,
          'startDate', scene.start_date,
          'endDate', scene.end_date,
          'minAvailablePercent', scene.min_available_percent
        ) order by scene.normalized_name, scene.id
      )
      from app.search_scenes as scene
      where scene.organization_id = organization.id
    ), '[]'::jsonb),
    'savedReports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', report.id,
          'name', report.name,
          'source', report.source,
          'groupBy', report.group_by,
          'metric', report.metric
        ) order by report.normalized_name, report.id
      )
      from app.saved_reports as report
      where report.organization_id = organization.id
    ), '[]'::jsonb),
    'profileRequests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', request.id,
          'personId', request.person_id,
          'scope', request.scope,
          'note', nullif(request.note, ''),
          'status', request.status,
          'proposedSkills', request.proposed_skills,
          'proposedWorkHistory', request.proposed_work_history
        ) order by request.created_at, request.id
      )
      from app.profile_requests as request
      where request.organization_id = organization.id
    ), '[]'::jsonb),
    'orgUnits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', unit.id,
          'name', unit.name,
          'parentId', unit.parent_id,
          'sortOrder', unit.sort_order
        ) order by unit.sort_order, unit.name, unit.id
      )
      from app.org_units as unit
      where unit.organization_id = organization.id
    ), '[]'::jsonb),
    'orgMemberships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', membership.id,
          'personId', membership.person_id,
          'orgUnitId', membership.org_unit_id,
          'isPrimary', membership.is_primary,
          'isManager', membership.is_manager
        ) order by membership.person_id, membership.is_primary desc, membership.org_unit_id
      )
      from app.person_org_units as membership
      where membership.organization_id = organization.id
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', person.id,
          'authUserId', person.user_id,
          'employeeCode', person.employee_code,
          'initials', person.initials,
          'name', person.name,
          'role', person.role_title,
          'department', person.department,
          'avatarTone', person.avatar_tone,
          'skills', coalesce((
            select jsonb_agg(skill.name order by skill.normalized_name, skill.id)
            from app.person_skills as person_skill
            join app.skills as skill
              on skill.organization_id = person_skill.organization_id
             and skill.id = person_skill.skill_id
            where person_skill.organization_id = person.organization_id
              and person_skill.person_id = person.id
          ), '[]'::jsonb),
          'skillLevels', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'name', skill.name,
                'proficiency', person_skill.proficiency
              ) order by skill.normalized_name, skill.id
            )
            from app.person_skills as person_skill
            join app.skills as skill
              on skill.organization_id = person_skill.organization_id
             and skill.id = person_skill.skill_id
            where person_skill.organization_id = person.organization_id
              and person_skill.person_id = person.id
          ), '[]'::jsonb),
          'customValues', coalesce((
            select jsonb_object_agg(field.id::text, field_value.value_text)
            from app.custom_field_values as field_value
            join app.custom_fields as field
              on field.organization_id = field_value.organization_id
             and field.id = field_value.field_id
            where field_value.organization_id = person.organization_id
              and field_value.entity_id = person.id
              and field.entity_type = 'member'
          ), '{}'::jsonb),
          'workHistory', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', history.id,
                'title', history.title,
                'organization', history.organization_name,
                'startDate', history.start_date,
                'endDate', history.end_date,
                'description', nullif(history.description, '')
              ) order by coalesce(history.end_date, '9999-12-31'::date) desc, history.start_date desc, history.title
            )
            from app.work_history as history
            where history.organization_id = person.organization_id
              and history.person_id = person.id
          ), '[]'::jsonb),
          'location', person.location,
          'capacity', person.capacity_percent,
          'isActive', person.is_active,
          'version', person.version
        ) order by person.name, person.id
      )
      from app.people as person
      where person.organization_id = organization.id
        and person.is_active
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', project.id,
          'code', project.code,
          'name', project.name,
          'summary', project.summary,
          'status', project.status,
          'tone', project.tone,
          'ownerPersonId', project.owner_person_id,
          'ownerName', owner.name,
          'ownerInitials', owner.initials,
          'startDate', project.start_date,
          'endDate', project.end_date,
          'nextMilestone', project.next_milestone,
          'nextMilestoneDate', project.next_milestone_date,
          'progress', project.progress_percent,
          'demand', project.demand_headcount,
          'customValues', coalesce((
            select jsonb_object_agg(field.id::text, field_value.value_text)
            from app.custom_field_values as field_value
            join app.custom_fields as field
              on field.organization_id = field_value.organization_id
             and field.id = field_value.field_id
            where field_value.organization_id = project.organization_id
              and field_value.entity_id = project.id
              and field.entity_type = 'project'
          ), '{}'::jsonb),
          'version', project.version
        ) order by project.start_date, project.name, project.id
      )
      from app.projects as project
      left join app.people as owner
        on owner.organization_id = project.organization_id
       and owner.id = project.owner_person_id
      where project.organization_id = organization.id
        and project.archived_at is null
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', assignment.id,
          'personId', assignment.person_id,
          'projectId', assignment.project_id,
          'staffingNeedId', assignment.staffing_need_id,
          'startDate', assignment.start_date,
          'endDate', assignment.end_date,
          'allocation', assignment.allocation_percent,
          'status', assignment.status,
          'label', assignment.label,
          'version', assignment.version
        ) order by assignment.start_date, assignment.id
      )
      from app.assignments as assignment
      where assignment.organization_id = organization.id
        and assignment.status <> 'cancelled'
    ), '[]'::jsonb),
    'needs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', need.id,
          'projectId', need.project_id,
          'role', need.role_title,
          'skills', coalesce((
            select jsonb_agg(skill.name order by skill.normalized_name, skill.id)
            from app.staffing_need_skills as need_skill
            join app.skills as skill
              on skill.organization_id = need_skill.organization_id
             and skill.id = need_skill.skill_id
            where need_skill.organization_id = need.organization_id
              and need_skill.staffing_need_id = need.id
          ), '[]'::jsonb),
          'skillRequirements', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'name', skill.name,
                'minProficiency', need_skill.min_proficiency
              ) order by skill.normalized_name, skill.id
            )
            from app.staffing_need_skills as need_skill
            join app.skills as skill
              on skill.organization_id = need_skill.organization_id
             and skill.id = need_skill.skill_id
            where need_skill.organization_id = need.organization_id
              and need_skill.staffing_need_id = need.id
          ), '[]'::jsonb),
          'startDate', need.start_date,
          'endDate', need.end_date,
          'allocation', need.allocation_percent,
          'status', need.status,
          'draftPersonId', need.draft_person_id,
          'version', need.version
        ) order by need.start_date, need.id
      )
      from app.staffing_needs as need
      where need.organization_id = organization.id
        and need.status <> 'cancelled'
    ), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', opportunity.id,
          'code', opportunity.code,
          'name', opportunity.name,
          'summary', opportunity.summary,
          'stage', opportunity.stage,
          'tone', opportunity.tone,
          'ownerPersonId', opportunity.owner_person_id,
          'ownerName', owner.name,
          'ownerInitials', owner.initials,
          'startDate', opportunity.start_date,
          'endDate', opportunity.end_date,
          'demand', opportunity.demand_headcount,
          'convertedProjectId', opportunity.converted_project_id,
          'version', opportunity.version
        ) order by opportunity.start_date, opportunity.name, opportunity.id
      )
      from app.opportunities as opportunity
      left join app.people as owner
        on owner.organization_id = opportunity.organization_id
       and owner.id = opportunity.owner_person_id
      where opportunity.organization_id = organization.id
        and opportunity.archived_at is null
    ), '[]'::jsonb),
    'opportunityNeeds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', need.id,
          'opportunityId', need.opportunity_id,
          'role', need.role_title,
          'skills', coalesce((
            select jsonb_agg(skill.name order by skill.normalized_name, skill.id)
            from app.opportunity_need_skills as need_skill
            join app.skills as skill
              on skill.organization_id = need_skill.organization_id
             and skill.id = need_skill.skill_id
            where need_skill.organization_id = need.organization_id
              and need_skill.opportunity_need_id = need.id
          ), '[]'::jsonb),
          'skillRequirements', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'name', skill.name,
                'minProficiency', need_skill.min_proficiency
              ) order by skill.normalized_name, skill.id
            )
            from app.opportunity_need_skills as need_skill
            join app.skills as skill
              on skill.organization_id = need_skill.organization_id
             and skill.id = need_skill.skill_id
            where need_skill.organization_id = need.organization_id
              and need_skill.opportunity_need_id = need.id
          ), '[]'::jsonb),
          'startDate', need.start_date,
          'endDate', need.end_date,
          'allocation', need.allocation_percent,
          'version', need.version
        ) order by need.start_date, need.id
      )
      from app.opportunity_needs as need
      where need.organization_id = organization.id
        and need.status <> 'cancelled'
    ), '[]'::jsonb)
  )
  into v_result
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null;

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  return private.scoped_workspace(p_organization_id, v_result);
end;
$function$;

create or replace function public.list_favorites(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id is required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  -- set_favorite returns through this function, so one gate covers both RPCs.
  if private.role_feature_disabled(p_organization_id, 'favorites') then
    raise exception using errcode = '42501', message = 'favorites are disabled for this role';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'kind', favorite.kind,
      'targetId', favorite.target_id
    ) order by favorite.created_at, favorite.target_id
  ), '[]'::jsonb)
  into v_result
  from app.favorites as favorite
  where favorite.organization_id = p_organization_id
    and favorite.user_id = v_user_id
    and (
      (
        favorite.kind = 'member'
        and exists (
          select 1
          from app.people as person
          where person.organization_id = favorite.organization_id
            and person.id = favorite.target_id
            and person.is_active
        )
      )
      or (
        favorite.kind = 'project'
        and exists (
          select 1
          from app.projects as project
          where project.organization_id = favorite.organization_id
            and project.id = favorite.target_id
            and project.archived_at is null
        )
      )
    );

  return jsonb_build_object('favorites', v_result);
end;
$function$;

comment on table app.role_permissions is $comment$
Per-role field, feature, and data-scope limits layered on top of the four
organization roles. Owner is always unrestricted and has no row. A missing row
means unrestricted, so the table is empty until an owner configures a role.
Only public.save_workspace writes here, through private.apply_role_permissions.
$comment$;

comment on function private.visible_person_ids(uuid, text, uuid) is $comment$
People a caller may see under person_scope unit, unit_subtree, or self. The
basis is the caller's own app.people row (matched on user_id) and its primary
app.person_org_units row. The unit walk stops at depth 16, matching the
org-unit cycle guard. Returns an empty array when the caller has no person row.
$comment$;

comment on function private.scoped_workspace(uuid, jsonb) is $comment$
Applies the caller's role permissions to an assembled workspace snapshot and
appends the resolved "permissions" key. Every read path reaches this through
public.get_workspace, so Web UI, AI chat, the external API, and MCP share one
rule. Disabled feature sections become empty arrays rather than missing keys.
$comment$;

comment on function private.assert_role_permissions_allow(uuid, jsonb) is $comment$
Write-side counterpart of private.scoped_workspace. Rejects payloads that touch
a disabled feature, a hidden or read-only custom field, or a person outside the
caller's data scope. The existing role and section rules are unchanged and stay
in private.save_workspace_core and the private.apply_* functions.
$comment$;

comment on function private.apply_role_permissions(uuid, jsonb, uuid) is $comment$
Applies payload.rolePermissions.upsert. Owners and admins may change the
planner and viewer rows; only owners may change the admin row, so a restricted
administrator cannot lift its own restrictions. Unknown custom field keys and
unsupported feature keys are rejected.
$comment$;

comment on function private.role_feature_disabled(uuid, text) is $comment$
True when the caller's role disables the named feature. Owners never match.
$comment$;

comment on function private.locked_custom_field_ids(uuid) is $comment$
Custom field ids the caller may not write: hidden plus read-only for its role.
Empty for owners and for roles without a permission row.
$comment$;

revoke all on function private.visible_person_ids(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.locked_custom_field_ids(uuid) from public, anon, authenticated;
revoke all on function private.apply_custom_values(uuid, jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function private.role_feature_disabled(uuid, text) from public, anon, authenticated;
revoke all on function private.scoped_workspace(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.assert_role_permissions_allow(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.role_permission_keys(jsonb, text) from public, anon, authenticated;
revoke all on function private.apply_role_permissions(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.workspace_core_payload(jsonb) from public, anon, authenticated;
revoke all on function private.assert_integration_payload_scopes(app.integration_clients, jsonb) from public, anon, authenticated;
revoke all on function public.save_workspace(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.get_workspace(uuid) from public, anon, authenticated;
revoke all on function public.list_favorites(uuid) from public, anon, authenticated;

grant execute on function public.get_workspace(uuid) to authenticated;
grant execute on function public.save_workspace(uuid, bigint, uuid, jsonb, text) to authenticated;
grant execute on function public.list_favorites(uuid) to authenticated;

commit;
