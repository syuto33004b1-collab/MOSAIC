begin;

create table app.org_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  parent_id uuid,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id)
);

create unique index org_units_name_uidx
  on app.org_units (organization_id, lower(btrim(name)));

alter table app.org_units
  add constraint org_units_parent_fk
  foreign key (organization_id, parent_id)
  references app.org_units (organization_id, id)
  on delete restrict;

create table app.person_org_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  person_id uuid not null,
  org_unit_id uuid not null,
  is_primary boolean not null default false,
  is_manager boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  unique (organization_id, person_id, org_unit_id),
  foreign key (organization_id, person_id)
    references app.people (organization_id, id)
    on delete cascade,
  foreign key (organization_id, org_unit_id)
    references app.org_units (organization_id, id)
    on delete restrict
);

create unique index person_org_units_primary_uidx
  on app.person_org_units (organization_id, person_id)
  where is_primary;

create index org_units_organization_idx
  on app.org_units (organization_id, sort_order, name);
create index person_org_units_person_idx
  on app.person_org_units (organization_id, person_id);
create index person_org_units_unit_idx
  on app.person_org_units (organization_id, org_unit_id);

alter table app.org_units enable row level security;
alter table app.org_units force row level security;
alter table app.person_org_units enable row level security;
alter table app.person_org_units force row level security;

create policy org_units_select_member on app.org_units
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy person_org_units_select_member on app.person_org_units
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create or replace function private.org_unit_has_cycle(p_organization_id uuid, p_unit_id uuid, p_parent_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  with recursive walk as (
    select p_parent_id as id, 1 as depth
    union all
    select unit.parent_id, walk.depth + 1
    from walk
    join app.org_units as unit
      on unit.organization_id = p_organization_id
     and unit.id = walk.id
    where unit.parent_id is not null
      and walk.depth < 16
  )
  select exists (
    select 1 from walk where walk.id = p_unit_id
  );
$function$;

create or replace function private.guard_org_unit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_parent app.org_units%rowtype;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception using errcode = '23514', message = 'organization unit cannot contain a cycle';
    end if;
    select *
    into v_parent
    from app.org_units as unit
    where unit.organization_id = new.organization_id
      and unit.id = new.parent_id;
    if not found then
      raise exception using errcode = '23503', message = 'org unit parent must belong to the same organization';
    end if;
    if private.org_unit_has_cycle(new.organization_id, new.id, new.parent_id) then
      raise exception using errcode = '23514', message = 'organization unit cannot contain a cycle';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists org_units_guard on app.org_units;
create trigger org_units_guard
before insert or update on app.org_units
for each row
execute function private.guard_org_unit();

create trigger org_units_touch
before insert or update on app.org_units
for each row execute function private.touch_versioned_row();

create trigger org_units_audit
after insert or update or delete on app.org_units
for each row execute function private.audit_row_change();
create trigger person_org_units_audit
after insert or update or delete on app.person_org_units
for each row execute function private.audit_row_change();

create or replace function private.apply_org_units(
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
  v_parent uuid;
  v_affected integer;
begin
  if not (p_payload ? 'orgUnits') then
    return;
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'only owners and admins may change organization units';
  end if;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['orgUnits', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'orgUnits.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    insert into app.org_units (
      id, organization_id, name, parent_id, sort_order, created_by, updated_by
    ) values (
      v_id,
      p_organization_id,
      btrim(v_item ->> 'name'),
      null,
      coalesce(nullif(v_item ->> 'sortOrder', '')::integer, 0),
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (id) do update
    set
      name = excluded.name,
      sort_order = excluded.sort_order,
      updated_by = p_actor_user_id
    where app.org_units.organization_id = p_organization_id;
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.org_units as existing
      where existing.organization_id = p_organization_id
        and existing.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'org unit id is not valid for this organization';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['orgUnits', 'upsert']::text[]))
  loop
    v_id := (v_item ->> 'id')::uuid;
    v_parent := nullif(v_item ->> 'parentId', '')::uuid;
    update app.org_units as unit
    set parent_id = v_parent, updated_by = p_actor_user_id
    where unit.organization_id = p_organization_id
      and unit.id = v_id;
  end loop;
end;
$function$;

create or replace function private.apply_org_memberships(
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
  v_person_ids uuid[] := '{}';
begin
  if not (p_payload ? 'orgMemberships') then
    return;
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'only owners and admins may change organization units';
  end if;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['orgMemberships', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'orgMemberships.upsert entries must be objects';
    end if;
    v_person_ids := array_append(v_person_ids, (v_item ->> 'personId')::uuid);
  end loop;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['orgMemberships', 'archiveIds']::text[]))
  loop
    v_id := (v_item #>> '{}')::uuid;
    v_person_ids := array_cat(
      v_person_ids,
      array(
        select membership.person_id
        from app.person_org_units as membership
        where membership.organization_id = p_organization_id
          and membership.id = v_id
      )
    );
  end loop;

  delete from app.person_org_units as membership
  where membership.organization_id = p_organization_id
    and membership.person_id = any(v_person_ids);

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['orgMemberships', 'upsert']::text[]))
  loop
    insert into app.person_org_units (
      id, organization_id, person_id, org_unit_id, is_primary, is_manager, created_by
    ) values (
      (v_item ->> 'id')::uuid,
      p_organization_id,
      (v_item ->> 'personId')::uuid,
      (v_item ->> 'orgUnitId')::uuid,
      coalesce((v_item ->> 'isPrimary')::boolean, false),
      coalesce((v_item ->> 'isManager')::boolean, false),
      p_actor_user_id
    );
  end loop;
end;
$function$;

create or replace function private.apply_org_unit_archives(
  p_organization_id uuid,
  p_payload jsonb
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
  v_affected integer;
begin
  if not (p_payload ? 'orgUnits') then
    return;
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'only owners and admins may change organization units';
  end if;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['orgUnits', 'archiveIds']::text[]))
  loop
    v_id := (v_item #>> '{}')::uuid;
    if exists (
      select 1 from app.org_units as unit
      where unit.organization_id = p_organization_id
        and unit.parent_id = v_id
    ) then
      raise exception using errcode = '23514', message = 'org unit still has child units';
    end if;
    if exists (
      select 1 from app.person_org_units as membership
      where membership.organization_id = p_organization_id
        and membership.org_unit_id = v_id
    ) then
      raise exception using errcode = '23514', message = 'org unit still has members';
    end if;
    delete from app.org_units as unit
    where unit.organization_id = p_organization_id
      and unit.id = v_id;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'orgUnits.archiveIds contains an unknown id';
    end if;
  end loop;
end;
$function$;

create or replace function private.sync_people_departments_from_org(
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  update app.people as person
  set
    department = unit.name,
    updated_by = p_actor_user_id
  from app.person_org_units as membership
  join app.org_units as unit
    on unit.organization_id = membership.organization_id
   and unit.id = membership.org_unit_id
  where person.organization_id = p_organization_id
    and membership.organization_id = p_organization_id
    and membership.person_id = person.id
    and membership.is_primary
    and person.department is distinct from unit.name;
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

  return v_result;
end;
$function$;

comment on function public.get_workspace(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns one consistent snapshot including skillCatalog, customFields, orgUnits, orgMemberships, opportunities, opportunityNeeds, member/project customValues, and member workHistory.
Archived people/projects and cancelled assignments/needs are omitted.
$comment$;

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
  if (p_payload - array['members', 'projects', 'assignments', 'needs', 'skillCatalog', 'customFields', 'orgUnits', 'orgMemberships', 'opportunities', 'opportunityNeeds']::text[]) <> '{}'::jsonb then
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
  return p_payload - 'skillCatalog' - 'customFields' - 'orgUnits' - 'orgMemberships' - 'opportunities' - 'opportunityNeeds';
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
  perform private.apply_custom_values(p_organization_id, p_payload, auth.uid(), 'members', 'member');
  perform private.apply_custom_values(p_organization_id, p_payload, auth.uid(), 'projects', 'project');
  perform private.apply_work_history(p_organization_id, p_payload, auth.uid());
  perform private.apply_org_units(p_organization_id, p_payload, auth.uid());
  perform private.apply_org_memberships(p_organization_id, p_payload, auth.uid());
  perform private.apply_org_unit_archives(p_organization_id, p_payload);
  perform private.sync_people_departments_from_org(p_organization_id, auth.uid());
  perform private.apply_opportunities(p_organization_id, p_payload, auth.uid());
  perform private.apply_opportunity_needs(p_organization_id, p_payload, auth.uid());
  perform private.assert_skill_proficiency_matches(p_organization_id);
  return v_result;
end;
$function$;

comment on function public.save_workspace(uuid, bigint, uuid, jsonb, text) is $comment$
Arguments:
  p_organization_id uuid
  p_expected_revision bigint
  p_request_id uuid
  p_payload jsonb
  p_payload_hash text (lowercase 64-character SHA-256 hex of the client payload)

Payload shape is the existing members/projects/assignments/needs/skillCatalog/customFields/opportunities/opportunityNeeds contract, plus:
{
  "orgUnits": {
    "upsert": [{"id","name","parentId?","sortOrder?"}],
    "archiveIds": ["uuid"]
  },
  "orgMemberships": {
    "upsert": [{"id","personId","orgUnitId","isPrimary","isManager"}],
    "archiveIds": ["uuid"]
  }
}
Organization units and memberships are owner/admin only. Unit archives are applied after memberships.
$comment$;


revoke all on function private.org_unit_has_cycle(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.guard_org_unit() from public, anon, authenticated;
revoke all on function private.apply_org_units(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_org_memberships(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_org_unit_archives(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.sync_people_departments_from_org(uuid, uuid) from public, anon, authenticated;
revoke all on function private.workspace_core_payload(jsonb) from public, anon, authenticated;
revoke all on function private.apply_custom_fields(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_custom_values(uuid, jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function private.apply_work_history(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_skill_catalog(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_skill_levels(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.assert_skill_proficiency_matches(uuid) from public, anon, authenticated;
revoke all on function private.save_workspace_core(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.save_workspace(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.get_workspace(uuid) from public, anon, authenticated;

grant execute on function public.get_workspace(uuid) to authenticated;
grant execute on function public.save_workspace(uuid, bigint, uuid, jsonb, text) to authenticated;

revoke all on table app.org_units from public, anon, authenticated, service_role;
revoke all on table app.person_org_units from public, anon, authenticated, service_role;

commit;
