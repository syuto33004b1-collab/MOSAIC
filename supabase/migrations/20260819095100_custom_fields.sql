begin;

create table app.custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  entity_type text not null check (entity_type in ('member', 'project')),
  field_key text not null check (
    field_key = lower(field_key)
    and field_key ~ '^[a-z][a-z0-9_]{0,39}$'
  ),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  field_type text not null check (field_type in ('text', 'number', 'date', 'select')),
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  show_in_list boolean not null default false,
  show_in_detail boolean not null default true,
  searchable boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, entity_type, field_key),
  unique (organization_id, id),
  check (field_type <> 'select' or jsonb_array_length(options) >= 1),
  check (field_type = 'select' or options = '[]'::jsonb)
);

create table app.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  field_id uuid not null,
  entity_id uuid not null,
  value_text text not null check (char_length(btrim(value_text)) between 1 and 200),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (organization_id, field_id, entity_id),
  foreign key (organization_id, field_id)
    references app.custom_fields (organization_id, id)
    on delete cascade
);

create table app.work_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  person_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  organization_name text not null check (char_length(btrim(organization_name)) between 1 and 160),
  start_date date not null,
  end_date date,
  description text not null default '' check (char_length(description) <= 2000),
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  foreign key (organization_id, person_id)
    references app.people (organization_id, id)
    on delete cascade,
  check (end_date is null or end_date >= start_date)
);

create index custom_fields_organization_idx
  on app.custom_fields (organization_id, entity_type, sort_order, label);
create index custom_field_values_entity_idx
  on app.custom_field_values (organization_id, entity_id);
create index work_history_person_idx
  on app.work_history (organization_id, person_id, start_date desc);

alter table app.custom_fields enable row level security;
alter table app.custom_fields force row level security;
alter table app.custom_field_values enable row level security;
alter table app.custom_field_values force row level security;
alter table app.work_history enable row level security;
alter table app.work_history force row level security;

create policy custom_fields_select_member on app.custom_fields
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy custom_field_values_select_member on app.custom_field_values
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy work_history_select_member on app.work_history
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create or replace function private.guard_custom_field_value()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_field app.custom_fields%rowtype;
begin
  select *
  into v_field
  from app.custom_fields as field
  where field.organization_id = new.organization_id
    and field.id = new.field_id;
  if not found then
    raise exception using errcode = '23503', message = 'custom field must belong to the same organization';
  end if;

  if v_field.entity_type = 'member' then
    if not exists (
      select 1 from app.people as person
      where person.organization_id = new.organization_id
        and person.id = new.entity_id
    ) then
      raise exception using errcode = '23503', message = 'custom field value must reference a member in the same organization';
    end if;
  elsif not exists (
    select 1 from app.projects as project
    where project.organization_id = new.organization_id
      and project.id = new.entity_id
  ) then
    raise exception using errcode = '23503', message = 'custom field value must reference a project in the same organization';
  end if;

  if v_field.field_type = 'number' and new.value_text !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception using errcode = '23514', message = 'custom field number values must be numeric';
  end if;
  if v_field.field_type = 'date' and new.value_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '23514', message = 'custom field date values must use YYYY-MM-DD';
  end if;
  if v_field.field_type = 'select' and not (v_field.options @> to_jsonb(new.value_text)) then
    raise exception using errcode = '23514', message = 'custom field select values must match an option';
  end if;
  return new;
end;
$function$;

drop trigger if exists custom_field_values_guard on app.custom_field_values;
create trigger custom_field_values_guard
before insert or update on app.custom_field_values
for each row
execute function private.guard_custom_field_value();

create trigger custom_fields_touch
before insert or update on app.custom_fields
for each row execute function private.touch_versioned_row();
create trigger work_history_touch
before insert or update on app.work_history
for each row execute function private.touch_versioned_row();

create trigger custom_fields_audit
after insert or update or delete on app.custom_fields
for each row execute function private.audit_row_change();
create trigger custom_field_values_audit
after insert or update or delete on app.custom_field_values
for each row execute function private.audit_row_change();
create trigger work_history_audit
after insert or update or delete on app.work_history
for each row execute function private.audit_row_change();

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
Returns one consistent snapshot including skillCatalog, customFields, member/project customValues, and member workHistory.
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
  if (p_payload - array['members', 'projects', 'assignments', 'needs', 'skillCatalog', 'customFields']::text[]) <> '{}'::jsonb then
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
  return p_payload - 'skillCatalog' - 'customFields';
end;
$function$;

create or replace function private.apply_custom_fields(
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
  v_options jsonb;
  v_affected integer;
begin
  if not (p_payload ? 'customFields') then
    return;
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'only owners and admins may change custom fields';
  end if;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['customFields', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'customFields.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    v_options := case
      when jsonb_typeof(v_item -> 'options') = 'array' then v_item -> 'options'
      else '[]'::jsonb
    end;
    insert into app.custom_fields (
      id, organization_id, entity_type, field_key, label, field_type, required, options,
      show_in_list, show_in_detail, searchable, sort_order, created_by, updated_by
    ) values (
      v_id,
      p_organization_id,
      v_item ->> 'entityType',
      lower(btrim(v_item ->> 'key')),
      btrim(v_item ->> 'label'),
      v_item ->> 'fieldType',
      coalesce((v_item ->> 'required')::boolean, false),
      v_options,
      coalesce((v_item ->> 'showInList')::boolean, false),
      coalesce((v_item ->> 'showInDetail')::boolean, true),
      coalesce((v_item ->> 'searchable')::boolean, true),
      coalesce(nullif(v_item ->> 'sortOrder', '')::integer, 0),
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (id) do update
    set
      entity_type = excluded.entity_type,
      field_key = excluded.field_key,
      label = excluded.label,
      field_type = excluded.field_type,
      required = excluded.required,
      options = excluded.options,
      show_in_list = excluded.show_in_list,
      show_in_detail = excluded.show_in_detail,
      searchable = excluded.searchable,
      sort_order = excluded.sort_order,
      updated_by = p_actor_user_id
    where app.custom_fields.organization_id = p_organization_id;
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.custom_fields as existing
      where existing.organization_id = p_organization_id
        and existing.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'custom field id is not valid for this organization';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['customFields', 'archiveIds']::text[]))
  loop
    v_id := (v_item #>> '{}')::uuid;
    delete from app.custom_fields as field
    where field.organization_id = p_organization_id
      and field.id = v_id;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'customFields.archiveIds contains an unknown id';
    end if;
  end loop;
end;
$function$;

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
      and field.entity_type = p_entity_type;

    for v_pair in
      select key, value
      from jsonb_each_text(v_item -> 'customValues')
    loop
      v_value := btrim(v_pair.value);
      if v_value = '' then
        continue;
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

create or replace function private.apply_work_history(
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
  v_entry jsonb;
  v_id uuid;
  v_sort integer;
begin
  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['members', 'upsert']::text[]))
  loop
    if not (v_item ? 'workHistory') then
      continue;
    end if;
    if jsonb_typeof(v_item -> 'workHistory') <> 'array' then
      raise exception using errcode = '22023', message = 'workHistory must be a JSON array';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    delete from app.work_history as history
    where history.organization_id = p_organization_id
      and history.person_id = v_id;

    v_sort := 0;
    for v_entry in
      select value from jsonb_array_elements(v_item -> 'workHistory')
    loop
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception using errcode = '22023', message = 'workHistory entries must be objects';
      end if;
      v_sort := v_sort + 10;
      insert into app.work_history (
        id, organization_id, person_id, title, organization_name, start_date, end_date, description, sort_order, created_by, updated_by
      ) values (
        (v_entry ->> 'id')::uuid,
        p_organization_id,
        v_id,
        btrim(v_entry ->> 'title'),
        btrim(v_entry ->> 'organization'),
        (v_entry ->> 'startDate')::date,
        nullif(v_entry ->> 'endDate', '')::date,
        coalesce(v_entry ->> 'description', ''),
        v_sort,
        p_actor_user_id,
        p_actor_user_id
      );
    end loop;
  end loop;
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

Payload shape is the existing members/projects/assignments/needs/skillCatalog contract, plus:
{
  "customFields": {
    "upsert": [{"id","entityType","key","label","fieldType","required?","options?","showInList?","showInDetail?","searchable?","sortOrder?"}],
    "archiveIds": ["uuid"]
  },
  "members.upsert[].customValues": {"fieldId":"value"},
  "members.upsert[].workHistory": [{"id","title","organization","startDate","endDate?","description?"}],
  "projects.upsert[].customValues": {"fieldId":"value"}
}
Custom field definitions are owner/admin only. Values follow the field type and required flags.
$comment$;

revoke all on function private.guard_custom_field_value() from public, anon, authenticated;
revoke all on function private.apply_custom_fields(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_custom_values(uuid, jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function private.apply_work_history(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.workspace_core_payload(jsonb) from public, anon, authenticated;
revoke all on function private.apply_skill_catalog(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_skill_levels(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.assert_skill_proficiency_matches(uuid) from public, anon, authenticated;
revoke all on function private.save_workspace_core(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.save_workspace(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.get_workspace(uuid) from public, anon, authenticated;

grant execute on function public.get_workspace(uuid) to authenticated;
grant execute on function public.save_workspace(uuid, bigint, uuid, jsonb, text) to authenticated;

revoke all on table app.custom_fields from public, anon, authenticated, service_role;
revoke all on table app.custom_field_values from public, anon, authenticated, service_role;
revoke all on table app.work_history from public, anon, authenticated, service_role;

commit;
