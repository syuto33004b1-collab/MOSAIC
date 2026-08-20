begin;

create table app.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  code text not null check (
    char_length(btrim(code)) between 1 and 20
    and code = upper(code)
  ),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  summary text not null default '' check (char_length(summary) <= 2000),
  stage text not null check (stage in ('inquiry', 'proposal', 'negotiation', 'won', 'lost')),
  tone text not null default 'sky' check (tone in ('blue', 'mint', 'orange', 'plum', 'sky')),
  owner_person_id uuid,
  start_date date not null,
  end_date date not null,
  demand_headcount integer not null default 0 check (demand_headcount between 0 and 10000),
  converted_project_id uuid,
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (end_date >= start_date),
  check (
    (stage = 'won' and converted_project_id is not null)
    or (stage <> 'won' and converted_project_id is null)
  ),
  unique (organization_id, id),
  foreign key (organization_id, owner_person_id)
    references app.people (organization_id, id) on delete restrict,
  foreign key (organization_id, converted_project_id)
    references app.projects (organization_id, id) on delete restrict
);

create unique index opportunities_active_code_uidx
  on app.opportunities (organization_id, code)
  where archived_at is null;

create table app.opportunity_needs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  role_title text not null check (char_length(btrim(role_title)) between 1 and 120),
  start_date date not null,
  end_date date not null,
  allocation_percent numeric(5,2) not null check (
    allocation_percent > 0 and allocation_percent <= 100
  ),
  status text not null default 'open' check (status in ('open', 'cancelled')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (end_date >= start_date),
  unique (organization_id, id),
  foreign key (organization_id, opportunity_id)
    references app.opportunities (organization_id, id) on delete restrict
);

create table app.opportunity_need_skills (
  organization_id uuid not null,
  opportunity_need_id uuid not null,
  skill_id uuid not null,
  min_proficiency smallint not null default 1 check (min_proficiency between 1 and 5),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (organization_id, opportunity_need_id, skill_id),
  foreign key (organization_id, opportunity_need_id)
    references app.opportunity_needs (organization_id, id) on delete cascade,
  foreign key (organization_id, skill_id)
    references app.skills (organization_id, id) on delete cascade
);

create index opportunities_organization_idx
  on app.opportunities (organization_id, start_date, name);
create index opportunity_needs_opportunity_idx
  on app.opportunity_needs (organization_id, opportunity_id, start_date);
create index opportunity_need_skills_need_idx
  on app.opportunity_need_skills (organization_id, opportunity_need_id);

alter table app.opportunities enable row level security;
alter table app.opportunities force row level security;
alter table app.opportunity_needs enable row level security;
alter table app.opportunity_needs force row level security;
alter table app.opportunity_need_skills enable row level security;
alter table app.opportunity_need_skills force row level security;

create policy opportunities_select_member on app.opportunities
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy opportunity_needs_select_member on app.opportunity_needs
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy opportunity_need_skills_select_member on app.opportunity_need_skills
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create trigger opportunities_touch
before insert or update on app.opportunities
for each row execute function private.touch_versioned_row();
create trigger opportunity_needs_touch
before insert or update on app.opportunity_needs
for each row execute function private.touch_versioned_row();

create trigger opportunities_audit
after insert or update or delete on app.opportunities
for each row execute function private.audit_row_change();
create trigger opportunity_needs_audit
after insert or update or delete on app.opportunity_needs
for each row execute function private.audit_row_change();
create trigger opportunity_need_skills_audit
after insert or update or delete on app.opportunity_need_skills
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
Returns one consistent snapshot including skillCatalog, customFields, member/project customValues, member workHistory, opportunities, and opportunityNeeds.
Archived people/projects/opportunities and cancelled assignments/needs/opportunity needs are omitted.
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
  if (p_payload - array['members', 'projects', 'assignments', 'needs', 'skillCatalog', 'customFields', 'opportunities', 'opportunityNeeds']::text[]) <> '{}'::jsonb then
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
  return p_payload - 'skillCatalog' - 'customFields' - 'opportunities' - 'opportunityNeeds';
end;
$function$;

create or replace function private.apply_opportunities(
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
  v_owner_person_id uuid;
  v_converted_project_id uuid;
  v_affected integer;
begin
  if not (p_payload ? 'opportunities') then
    return;
  end if;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['opportunities', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'opportunities.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    v_owner_person_id := nullif(v_item ->> 'ownerPersonId', '')::uuid;
    v_converted_project_id := nullif(v_item ->> 'convertedProjectId', '')::uuid;
    if v_owner_person_id is null then
      select existing.owner_person_id
      into v_owner_person_id
      from app.opportunities as existing
      where existing.organization_id = p_organization_id
        and existing.id = v_id;
    end if;

    insert into app.opportunities (
      id, organization_id, code, name, summary, stage, tone, owner_person_id,
      start_date, end_date, demand_headcount, converted_project_id, created_by, updated_by
    ) values (
      v_id,
      p_organization_id,
      upper(btrim(v_item ->> 'code')),
      btrim(v_item ->> 'name'),
      coalesce(v_item ->> 'summary', ''),
      v_item ->> 'stage',
      coalesce(nullif(v_item ->> 'tone', ''), 'sky'),
      v_owner_person_id,
      (v_item ->> 'startDate')::date,
      (v_item ->> 'endDate')::date,
      (v_item ->> 'demand')::integer,
      v_converted_project_id,
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (id) do update
    set
      code = excluded.code,
      name = excluded.name,
      summary = excluded.summary,
      stage = excluded.stage,
      tone = excluded.tone,
      owner_person_id = case
        when v_owner_person_id is not null then v_owner_person_id
        else app.opportunities.owner_person_id
      end,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      demand_headcount = excluded.demand_headcount,
      converted_project_id = excluded.converted_project_id,
      updated_by = p_actor_user_id
    where app.opportunities.organization_id = p_organization_id;
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.opportunities as existing
      where existing.organization_id = p_organization_id
        and existing.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'opportunity id is not valid for this organization';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['opportunities', 'archiveIds']::text[]))
  loop
    v_id := (v_item #>> '{}')::uuid;
    update app.opportunities as opportunity
    set archived_at = coalesce(opportunity.archived_at, now()), updated_by = p_actor_user_id
    where opportunity.organization_id = p_organization_id
      and opportunity.id = v_id;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'opportunities.archiveIds contains an unknown id';
    end if;
    update app.opportunity_needs as need
    set status = 'cancelled', updated_by = p_actor_user_id
    where need.organization_id = p_organization_id
      and need.opportunity_id = v_id
      and need.status <> 'cancelled';
  end loop;
end;
$function$;

create or replace function private.apply_opportunity_needs(
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
  v_level jsonb;
  v_id uuid;
  v_skill_id uuid;
  v_skill_name text;
  v_value integer;
  v_affected integer;
begin
  if not (p_payload ? 'opportunityNeeds') then
    return;
  end if;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['opportunityNeeds', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'opportunityNeeds.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    insert into app.opportunity_needs (
      id, organization_id, opportunity_id, role_title, start_date, end_date,
      allocation_percent, status, created_by, updated_by
    ) values (
      v_id,
      p_organization_id,
      (v_item ->> 'opportunityId')::uuid,
      btrim(v_item ->> 'role'),
      (v_item ->> 'startDate')::date,
      (v_item ->> 'endDate')::date,
      (v_item ->> 'allocation')::numeric,
      'open',
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (id) do update
    set
      opportunity_id = excluded.opportunity_id,
      role_title = excluded.role_title,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      allocation_percent = excluded.allocation_percent,
      status = 'open',
      updated_by = p_actor_user_id
    where app.opportunity_needs.organization_id = p_organization_id;
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.opportunity_needs as existing
      where existing.organization_id = p_organization_id
        and existing.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'opportunity need id is not valid for this organization';
    end if;

    delete from app.opportunity_need_skills as need_skill
    using app.skills as skill
    where need_skill.organization_id = p_organization_id
      and need_skill.opportunity_need_id = v_id
      and skill.organization_id = need_skill.organization_id
      and skill.id = need_skill.skill_id
      and not exists (
        select 1
        from jsonb_array_elements_text(private.payload_array(v_item, array['skills']::text[])) as desired_skill(name)
        where lower(btrim(desired_skill.name)) = skill.normalized_name
      );

    for v_level in
      select value from jsonb_array_elements(private.payload_array(v_item, array['skills']::text[]))
    loop
      v_skill_name := btrim(v_level #>> '{}');
      v_skill_id := private.get_or_create_skill(p_organization_id, v_skill_name, p_actor_user_id);
      insert into app.opportunity_need_skills (
        organization_id, opportunity_need_id, skill_id, created_by
      ) values (
        p_organization_id, v_id, v_skill_id, p_actor_user_id
      ) on conflict do nothing;
    end loop;

    if jsonb_typeof(v_item -> 'skillRequirements') = 'array' then
      for v_level in
        select value from jsonb_array_elements(v_item -> 'skillRequirements')
      loop
        v_skill_name := btrim(coalesce(v_level ->> 'name', v_level #>> '{}'));
        v_value := coalesce(nullif(v_level ->> 'minProficiency', '')::integer, 1);
        if v_value not between 1 and 5 then
          raise exception using errcode = '22023', message = 'minimum skill proficiency must be between 1 and 5';
        end if;
        update app.opportunity_need_skills as need_skill
        set min_proficiency = v_value
        from app.skills as skill
        where need_skill.organization_id = p_organization_id
          and need_skill.opportunity_need_id = v_id
          and skill.organization_id = need_skill.organization_id
          and skill.id = need_skill.skill_id
          and skill.normalized_name = lower(v_skill_name);
      end loop;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['opportunityNeeds', 'cancelIds']::text[]))
  loop
    v_id := (v_item #>> '{}')::uuid;
    update app.opportunity_needs as need
    set status = 'cancelled', updated_by = p_actor_user_id
    where need.organization_id = p_organization_id
      and need.id = v_id;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'opportunityNeeds.cancelIds contains an unknown id';
    end if;
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

Payload shape is the existing members/projects/assignments/needs/skillCatalog/customFields contract, plus:
{
  "opportunities": {
    "upsert": [{"id","code","name","summary","stage","tone?","ownerPersonId?","startDate","endDate","demand","convertedProjectId?"}],
    "archiveIds": ["uuid"]
  },
  "opportunityNeeds": {
    "upsert": [{"id","opportunityId","role","skills","skillRequirements?","startDate","endDate","allocation"}],
    "cancelIds": ["uuid"]
  }
}
Opportunity stages are inquiry / proposal / negotiation / won / lost. Won rows require convertedProjectId.
$comment$;

revoke all on function private.apply_opportunities(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_opportunity_needs(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.workspace_core_payload(jsonb) from public, anon, authenticated;
revoke all on function private.apply_skill_catalog(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_skill_levels(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.apply_custom_fields(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_custom_values(uuid, jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function private.apply_work_history(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.assert_skill_proficiency_matches(uuid) from public, anon, authenticated;
revoke all on function private.save_workspace_core(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.save_workspace(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.get_workspace(uuid) from public, anon, authenticated;

grant execute on function public.get_workspace(uuid) to authenticated;
grant execute on function public.save_workspace(uuid, bigint, uuid, jsonb, text) to authenticated;

revoke all on table app.opportunities from public, anon, authenticated, service_role;
revoke all on table app.opportunity_needs from public, anon, authenticated, service_role;
revoke all on table app.opportunity_need_skills from public, anon, authenticated, service_role;

commit;
