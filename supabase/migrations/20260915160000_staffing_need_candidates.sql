-- Candidates kept on a staffing need (#324). Nested on needs, not a top-level
-- payload key: personScope already filters draftPersonId on the same object, and
-- a sibling array would leak people the caller cannot see.
--
-- Three-valued like weekendWorkDates and unavailability:
--   key absent  → leave the rows alone
--   `[]`        → clear the rows the caller can see
--   `null`      → an error
--
-- Apply deletes only rows the caller would have received from get_workspace
-- (active people in their personScope). Hidden and archived people stay.
-- The 12-person cap is the total row count after the write, matching
-- MAX_PROPOSAL_MEMBERS.

create table app.staffing_need_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staffing_need_id uuid not null,
  person_id uuid not null,
  sort_order integer not null default 0
    check (sort_order >= 0 and sort_order < 100),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  unique (organization_id, staffing_need_id, person_id),
  foreign key (organization_id, staffing_need_id)
    references app.staffing_needs (organization_id, id)
    on delete cascade,
  foreign key (organization_id, person_id)
    references app.people (organization_id, id)
    on delete cascade
);

create index staffing_need_candidates_need_idx
  on app.staffing_need_candidates (organization_id, staffing_need_id, sort_order, person_id);

alter table app.staffing_need_candidates enable row level security;
alter table app.staffing_need_candidates force row level security;

create policy staffing_need_candidates_select_member on app.staffing_need_candidates
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create trigger staffing_need_candidates_touch
before insert or update on app.staffing_need_candidates
for each row execute function private.touch_versioned_row();

create trigger staffing_need_candidates_audit
after insert or update or delete on app.staffing_need_candidates
for each row execute function private.audit_row_change();

-- Active people this actor may see. organization scope (or no row / owner) is
-- every active person. New apply/assert code uses this so a third copy of the
-- visible-id query does not appear. The two existing call sites stay as they are.

create or replace function private.actor_visible_active_person_ids(
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_scope text := 'organization';
  v_visible uuid[];
begin
  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active';
  if v_role is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  if v_role <> 'owner' then
    select permission.person_scope
    into v_scope
    from app.role_permissions as permission
    where permission.organization_id = p_organization_id
      and permission.role = v_role;
    if not found then
      v_scope := 'organization';
    end if;
  end if;

  if v_scope = 'organization' then
    select coalesce(array_agg(person.id), '{}'::uuid[])
    into v_visible
    from app.people as person
    where person.organization_id = p_organization_id
      and person.is_active;
    return v_visible;
  end if;

  v_visible := private.visible_person_ids(p_organization_id, v_scope, p_actor_user_id);
  select coalesce(array_agg(person.id), '{}'::uuid[])
  into v_visible
  from app.people as person
  where person.organization_id = p_organization_id
    and person.is_active
    and person.id = any (v_visible);
  return v_visible;
end;
$function$;

revoke all on function private.actor_visible_active_person_ids(uuid, uuid) from public, anon, authenticated;

create or replace function private.apply_staffing_need_candidates(
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
  v_ids jsonb;
  v_need_id uuid;
  v_writable uuid[];
  v_person_id uuid;
  v_sort integer;
  v_existing app.staffing_need_candidates%rowtype;
  v_payload_ids uuid[] := '{}'::uuid[];
  v_count integer;
begin
  v_writable := private.actor_visible_active_person_ids(p_organization_id, p_actor_user_id);

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['needs', 'upsert']::text[]))
  loop
    if not (v_item ? 'candidatePersonIds') then
      continue;
    end if;
    v_ids := v_item -> 'candidatePersonIds';
    if jsonb_typeof(v_ids) <> 'array' then
      raise exception using errcode = '22023',
        message = 'needs.upsert[].candidatePersonIds must be a JSON array';
    end if;
    v_need_id := (v_item ->> 'id')::uuid;
    v_payload_ids := '{}'::uuid[];

    for v_sort, v_person_id in
      select (entry.ord - 1)::integer, entry.person_id::uuid
      from jsonb_array_elements_text(v_ids) with ordinality as entry(person_id, ord)
    loop
      if v_person_id is null then
        raise exception using errcode = '22023',
          message = 'needs.upsert[].candidatePersonIds must contain only member ids';
      end if;
      if v_person_id = any (v_payload_ids) then
        continue;
      end if;
      if not (v_person_id = any (v_writable)) then
        raise exception using errcode = '42501',
          message = 'this role cannot keep a member outside its data scope as a candidate';
      end if;
      v_payload_ids := v_payload_ids || v_person_id;
    end loop;

    delete from app.staffing_need_candidates as candidate
    where candidate.organization_id = p_organization_id
      and candidate.staffing_need_id = v_need_id
      and candidate.person_id = any (v_writable)
      and not (candidate.person_id = any (v_payload_ids));

    v_sort := 0;
    foreach v_person_id in array v_payload_ids
    loop
      select *
      into v_existing
      from app.staffing_need_candidates as candidate
      where candidate.organization_id = p_organization_id
        and candidate.staffing_need_id = v_need_id
        and candidate.person_id = v_person_id;
      if found then
        if v_existing.sort_order is distinct from v_sort then
          update app.staffing_need_candidates as candidate
          set
            sort_order = v_sort,
            updated_by = p_actor_user_id
          where candidate.organization_id = p_organization_id
            and candidate.id = v_existing.id;
        end if;
      else
        insert into app.staffing_need_candidates (
          organization_id, staffing_need_id, person_id, sort_order, created_by, updated_by
        ) values (
          p_organization_id, v_need_id, v_person_id, v_sort, p_actor_user_id, p_actor_user_id
        );
      end if;
      v_sort := v_sort + 1;
    end loop;

    select count(*)
    into v_count
    from app.staffing_need_candidates as candidate
    where candidate.organization_id = p_organization_id
      and candidate.staffing_need_id = v_need_id;
    if v_count > 12 then
      raise exception using errcode = '22023',
        message = 'needs.upsert[].candidatePersonIds may have at most 12 people';
    end if;
  end loop;
end;
$function$;

revoke all on function private.apply_staffing_need_candidates(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on table app.staffing_need_candidates from public, anon, authenticated, service_role;

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

  if tg_table_name = 'assignment_weekend_days' then
    -- Keyed like the other child tables: the parent's id is the entity, and the
    -- day is what tells two rows of it apart (#222).
    v_entity_id := coalesce((v_new ->> 'assignment_id')::uuid, (v_old ->> 'assignment_id')::uuid);
    v_entity_key := jsonb_build_object(
      'assignmentId', coalesce(v_new ->> 'assignment_id', v_old ->> 'assignment_id'),
      'workDate', coalesce(v_new ->> 'work_date', v_old ->> 'work_date')
    );
  elsif tg_table_name = 'person_skills' then
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
  elsif tg_table_name = 'staffing_need_candidates' then
    v_entity_id := coalesce((v_new ->> 'staffing_need_id')::uuid, (v_old ->> 'staffing_need_id')::uuid);
    v_entity_key := jsonb_build_object(
      'staffingNeedId', coalesce(v_new ->> 'staffing_need_id', v_old ->> 'staffing_need_id'),
      'personId', coalesce(v_new ->> 'person_id', v_old ->> 'person_id')
    );
  else
    v_entity_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
    v_entity_key := jsonb_build_object('id', v_entity_id);
  end if;
  v_request_id := nullif(current_setting('app.request_id', true), '')::uuid;

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
    new_data
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
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
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
      from jsonb_array_elements(
        private.payload_array(p_payload, array['needs', 'upsert']::text[])
      ) as entry(item)
      cross join lateral jsonb_array_elements_text(
        coalesce(entry.item -> 'candidatePersonIds', '[]'::jsonb)
      ) as candidate(person_id)
      where entry.item ? 'candidatePersonIds'
        and candidate.person_id not in (select visible.id::text from unnest(v_visible) as visible(id))
    ) then
      raise exception using errcode = '42501', message = 'this role cannot keep a member outside its data scope as a candidate';
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
  perform private.apply_person_unavailability(p_organization_id, p_payload, auth.uid());
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
  -- After the core save, so the assignments these hang off exist (#222).
  perform private.apply_assignment_weekend_days(p_organization_id, p_payload, auth.uid());
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
          'unavailability', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', leave.id,
                'startDate', leave.start_date,
                'endDate', leave.end_date,
                'capacityPercent', leave.capacity_percent::double precision,
                'note', nullif(leave.note, '')
              ) order by leave.start_date, leave.id
            )
            from app.person_unavailability as leave
            where leave.organization_id = person.organization_id
              and leave.person_id = person.id
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
          'version', assignment.version,
          -- Ordered, so the same data always serialises the same way (#222).
          'weekendWorkDates', coalesce((
            select jsonb_agg(to_char(weekend_day.work_date, 'YYYY-MM-DD') order by weekend_day.work_date)
            from app.assignment_weekend_days as weekend_day
            where weekend_day.organization_id = assignment.organization_id
              and weekend_day.assignment_id = assignment.id
          ), '[]'::jsonb)
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
          'candidatePersonIds', coalesce((
            select jsonb_agg(candidate.person_id order by candidate.sort_order, candidate.person_id)
            from app.staffing_need_candidates as candidate
            join app.people as person
              on person.organization_id = candidate.organization_id
             and person.id = candidate.person_id
             and person.is_active
            where candidate.organization_id = need.organization_id
              and candidate.staffing_need_id = need.id
          ), '[]'::jsonb),
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
