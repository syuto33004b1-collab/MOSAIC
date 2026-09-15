begin;

-- Planned monthly cost on a person. One value, yen, nullable. Hidden from
-- planner/viewer and from integration callers; admin may hide it via
-- hiddenFieldKeys (#373).

alter table app.people
  add column monthly_cost_yen integer
    check (monthly_cost_yen is null or (monthly_cost_yen >= 0 and monthly_cost_yen <= 1000000000));

create or replace function private.apply_monthly_cost(
  p_organization_id uuid,
  p_payload jsonb,
  p_actor_user_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_id uuid;
  v_role text;
  v_hidden text[] := '{}'::text[];
  v_locked boolean;
  v_raw jsonb;
  v_value integer;
begin
  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = auth.uid()
    and membership.status = 'active';

  if v_role is not null and v_role <> 'owner' then
    select permission.hidden_field_keys
    into v_hidden
    from app.role_permissions as permission
    where permission.organization_id = p_organization_id
      and permission.role = v_role;
    if not found then
      v_hidden := '{}'::text[];
    end if;
  end if;

  v_locked :=
    coalesce(nullif(current_setting('app.caller_kind', true), ''), 'user') = 'integration'
    or v_role is null
    or v_role not in ('owner', 'admin')
    or (v_role = 'admin' and 'monthlyCost' = any (v_hidden));

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['members', 'upsert']::text[]))
  loop
    if not (v_item ? 'monthlyCost') then
      continue;
    end if;
    if v_locked then
      raise exception using errcode = '42501', message = 'monthlyCost cannot be changed by this role';
    end if;

    v_id := (v_item ->> 'id')::uuid;
    v_raw := v_item -> 'monthlyCost';
    if v_raw = 'null'::jsonb then
      v_value := null;
    elsif jsonb_typeof(v_raw) = 'number' and (v_item ->> 'monthlyCost') ~ '^[0-9]+$' then
      v_value := (v_item ->> 'monthlyCost')::integer;
      if v_value > 1000000000 then
        raise exception using errcode = '22023', message = 'monthlyCost must be an integer between 0 and 1000000000';
      end if;
    else
      raise exception using errcode = '22023', message = 'monthlyCost must be an integer between 0 and 1000000000';
    end if;

    update app.people as person
    set monthly_cost_yen = v_value,
        updated_by = p_actor_user_id
    where person.organization_id = p_organization_id
      and person.id = v_id
      and person.monthly_cost_yen is distinct from v_value;
  end loop;
end;
$function$;

revoke all on function private.apply_monthly_cost(uuid, jsonb, uuid) from public, anon, authenticated;

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
    if 'monthlyCost' = any (v_readonly) then
      raise exception using errcode = '22023', message = 'monthlyCost cannot be read-only';
    end if;
    if exists (
      select 1
      from unnest(v_hidden || v_readonly) as entry(key)
      where entry.key <> 'monthlyCost'
        and not exists (
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
  v_caller_kind text;
  v_may_see_cost boolean;
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
        (
          case
            when entry.need ->> 'draftPersonId' is null then entry.need
            when (entry.need ->> 'draftPersonId')::uuid = any (v_visible) then entry.need
            else jsonb_set(entry.need, array['draftPersonId'], 'null'::jsonb)
          end
        ) || jsonb_build_object(
          'candidatePersonIds', coalesce((
            select jsonb_agg(candidate.person_id order by candidate.ord)
            from jsonb_array_elements_text(
              coalesce(entry.need -> 'candidatePersonIds', '[]'::jsonb)
            ) with ordinality as candidate(person_id, ord)
            where candidate.person_id::uuid = any (v_visible)
          ), '[]'::jsonb)
        )
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

  -- Attach after scope filter. get_workspace never puts monthlyCost on the
  -- snapshot; this is the only place that adds or withholds the key.
  v_caller_kind := coalesce(nullif(current_setting('app.caller_kind', true), ''), 'user');
  v_may_see_cost :=
    v_caller_kind <> 'integration'
    and (
      v_role = 'owner'
      or (v_role = 'admin' and not ('monthlyCost' = any (v_hidden)))
    );
  if v_may_see_cost then
    v_result := jsonb_set(v_result, array['members'], coalesce((
      select jsonb_agg(
        entry.member || jsonb_build_object('monthlyCost', person.monthly_cost_yen)
        order by entry.idx
      )
      from jsonb_array_elements(v_result -> 'members') with ordinality as entry(member, idx)
      left join app.people as person
        on person.organization_id = p_organization_id
       and person.id = (entry.member ->> 'id')::uuid
    ), '[]'::jsonb));
  end if;

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
  perform private.apply_person_unavailability(p_organization_id, p_payload, auth.uid());
  perform private.apply_monthly_cost(p_organization_id, p_payload, auth.uid());
  perform private.apply_org_units(p_organization_id, p_payload, auth.uid());
  perform private.apply_org_memberships(p_organization_id, p_payload, auth.uid());
  perform private.apply_org_unit_archives(p_organization_id, p_payload);
  perform private.sync_people_departments_from_org(p_organization_id, auth.uid());
  perform private.apply_search_scenes(p_organization_id, p_payload, auth.uid());
  perform private.apply_saved_reports(p_organization_id, p_payload, auth.uid());
  perform private.apply_profile_requests(p_organization_id, p_payload, auth.uid());
  perform private.apply_opportunities(p_organization_id, p_payload, auth.uid());
  perform private.apply_opportunity_needs(p_organization_id, p_payload, auth.uid());
  perform private.apply_staffing_need_candidates(p_organization_id, p_payload, auth.uid());
  perform private.apply_assignment_weekend_days(p_organization_id, p_payload, auth.uid());
  perform private.assert_skill_proficiency_matches(p_organization_id);
  return v_result;
end;
$function$;

commit;
