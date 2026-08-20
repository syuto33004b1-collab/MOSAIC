begin;

create table app.profile_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  person_id uuid not null,
  scope text not null check (scope in ('skills', 'workHistory', 'all')),
  note text not null default '' check (char_length(note) <= 400),
  status text not null check (status in ('open', 'submitted', 'done', 'cancelled')),
  proposed_skills jsonb not null default '[]'::jsonb check (jsonb_typeof(proposed_skills) = 'array' and jsonb_array_length(proposed_skills) <= 20),
  proposed_work_history jsonb not null default '[]'::jsonb check (jsonb_typeof(proposed_work_history) = 'array' and jsonb_array_length(proposed_work_history) <= 20),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  foreign key (organization_id, person_id)
    references app.people (organization_id, id)
    on delete cascade
);

create unique index profile_requests_active_person_idx
  on app.profile_requests (organization_id, person_id)
  where status in ('open', 'submitted');
create index profile_requests_organization_idx
  on app.profile_requests (organization_id, status, created_at);

alter table app.profile_requests enable row level security;
alter table app.profile_requests force row level security;

create policy profile_requests_select_member on app.profile_requests
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create trigger profile_requests_touch
before insert or update on app.profile_requests
for each row execute function private.touch_versioned_row();

create trigger profile_requests_audit
after insert or update or delete on app.profile_requests
for each row execute function private.audit_row_change();

create or replace function private.apply_profile_requests(
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
  v_person_id uuid;
  v_scope text;
  v_note text;
  v_status text;
  v_role text;
  v_existing app.profile_requests%rowtype;
  v_affected integer;
begin
  if not (p_payload ? 'profileRequests') then
    return;
  end if;

  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active';
  if v_role is null or v_role not in ('owner', 'admin', 'planner') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['profileRequests', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'profileRequests.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    v_person_id := (v_item ->> 'personId')::uuid;
    v_scope := v_item ->> 'scope';
    v_note := coalesce(btrim(v_item ->> 'note'), '');
    v_status := v_item ->> 'status';
    if v_scope is distinct from 'skills' and v_scope is distinct from 'workHistory' and v_scope is distinct from 'all' then
      raise exception using errcode = '22023', message = 'profile request scope must be skills, workHistory, or all';
    end if;
    if v_status is distinct from 'open' and v_status is distinct from 'submitted' and v_status is distinct from 'done' and v_status is distinct from 'cancelled' then
      raise exception using errcode = '22023', message = 'profile request status is invalid';
    end if;
    if char_length(v_note) > 400 then
      raise exception using errcode = '22023', message = 'profile request notes must be 400 characters or fewer';
    end if;

    select * into v_existing
    from app.profile_requests as existing
    where existing.organization_id = p_organization_id
      and existing.id = v_id;

    if v_role = 'planner' then
      if not found then
        raise exception using errcode = '42501', message = 'only owners and admins may create profile requests';
      end if;
      if v_existing.status is distinct from 'open' or v_status is distinct from 'submitted' then
        raise exception using errcode = '42501', message = 'planners may only submit open profile requests';
      end if;
      v_person_id := v_existing.person_id;
      v_scope := v_existing.scope;
      v_note := v_existing.note;
    elsif v_role not in ('owner', 'admin') then
      raise exception using errcode = '42501', message = 'only owners and admins may change profile requests';
    end if;

    insert into app.profile_requests (
      id, organization_id, person_id, scope, note, status, proposed_skills, proposed_work_history, created_by, updated_by
    ) values (
      v_id,
      p_organization_id,
      v_person_id,
      v_scope,
      v_note,
      v_status,
      coalesce(v_item -> 'proposedSkills', '[]'::jsonb),
      coalesce(v_item -> 'proposedWorkHistory', '[]'::jsonb),
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (id) do update
    set
      person_id = excluded.person_id,
      scope = excluded.scope,
      note = excluded.note,
      status = excluded.status,
      proposed_skills = excluded.proposed_skills,
      proposed_work_history = excluded.proposed_work_history,
      updated_by = p_actor_user_id
    where app.profile_requests.organization_id = p_organization_id;
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.profile_requests as existing
      where existing.organization_id = p_organization_id
        and existing.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'profile request id is not valid for this organization';
    end if;
  end loop;

  if v_role = 'planner' and jsonb_array_length(private.payload_array(p_payload, array['profileRequests', 'archiveIds']::text[])) > 0 then
    raise exception using errcode = '42501', message = 'only owners and admins may delete profile requests';
  end if;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['profileRequests', 'archiveIds']::text[]))
  loop
    v_id := (v_item #>> '{}')::uuid;
    delete from app.profile_requests as request
    where request.organization_id = p_organization_id
      and request.id = v_id;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'profileRequests.archiveIds contains an unknown id';
    end if;
  end loop;
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

  return v_result;
end;
$function$;

comment on function public.get_workspace(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns one consistent snapshot including skillCatalog, customFields, searchScenes, savedReports, profileRequests, orgUnits, orgMemberships, opportunities, opportunityNeeds, member/project customValues, and member workHistory.
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
  if (p_payload - array['members', 'projects', 'assignments', 'needs', 'skillCatalog', 'customFields', 'orgUnits', 'orgMemberships', 'opportunities', 'opportunityNeeds', 'searchScenes', 'savedReports', 'profileRequests']::text[]) <> '{}'::jsonb then
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
  return p_payload - 'skillCatalog' - 'customFields' - 'orgUnits' - 'orgMemberships' - 'opportunities' - 'opportunityNeeds' - 'searchScenes' - 'savedReports' - 'profileRequests';
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
  perform private.apply_search_scenes(p_organization_id, p_payload, auth.uid());
  perform private.apply_saved_reports(p_organization_id, p_payload, auth.uid());
  perform private.apply_profile_requests(p_organization_id, p_payload, auth.uid());
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

Payload shape is the existing members/projects/assignments/needs/skillCatalog/customFields/opportunities/opportunityNeeds/orgUnits/orgMemberships contract, plus searchScenes, savedReports, and profileRequests:
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
Organization units and memberships are owner/admin only. Unit archives are applied after memberships. Profile-request create/confirm/cancel are owner/admin only. Planners may submit an open request.
$comment$;

create or replace function public.submit_profile_request(
  p_organization_id uuid,
  p_profile_request_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
  p_proposed jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_request app.profile_requests%rowtype;
  v_person app.people%rowtype;
  v_revision bigint;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_profile_request_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'request ids are required';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'p_expected_revision must be zero or greater';
  end if;
  if p_proposed is null or jsonb_typeof(p_proposed) <> 'object' then
    raise exception using errcode = '22023', message = 'p_proposed must be a JSON object';
  end if;

  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';

  select organization.workspace_revision
  into v_revision
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;
  if v_revision is distinct from p_expected_revision then
    raise exception using
      errcode = '40001',
      message = 'workspace revision conflict',
      detail = 'expected=' || p_expected_revision::text || ', current=' || coalesce(v_revision::text, 'not-found');
  end if;

  select * into v_request
  from app.profile_requests as request
  where request.organization_id = p_organization_id
    and request.id = p_profile_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'profile request not found';
  end if;
  if v_request.status is distinct from 'open' then
    raise exception using errcode = '22023', message = 'this profile request cannot be submitted';
  end if;

  select * into v_person
  from app.people as person
  where person.organization_id = p_organization_id
    and person.id = v_request.person_id;
  if v_role not in ('owner', 'admin') and (v_person.user_id is null or v_person.user_id is distinct from v_user_id) then
    raise exception using errcode = '42501', message = 'only the assigned member may submit this profile request';
  end if;

  update app.profile_requests as request
  set
    status = 'submitted',
    proposed_skills = coalesce(p_proposed -> 'proposedSkills', '[]'::jsonb),
    proposed_work_history = coalesce(p_proposed -> 'proposedWorkHistory', '[]'::jsonb),
    updated_by = v_user_id
  where request.organization_id = p_organization_id
    and request.id = p_profile_request_id;

  update app.organizations as organization
  set
    workspace_revision = organization.workspace_revision + 1,
    workspace_changed_at = now(),
    workspace_changed_by = v_user_id
  where organization.id = p_organization_id
  returning organization.workspace_revision into v_revision;

  return jsonb_build_object(
    'revision', v_revision,
    'savedAt', (select organization.workspace_changed_at from app.organizations as organization where organization.id = p_organization_id)
  );
end;
$function$;

revoke all on function private.apply_search_scenes(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_saved_reports(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_profile_requests(uuid, jsonb, uuid) from public, anon, authenticated;
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
revoke all on function public.submit_profile_request(uuid, uuid, uuid, bigint, jsonb) from public, anon, authenticated;

grant execute on function public.get_workspace(uuid) to authenticated;
grant execute on function public.save_workspace(uuid, bigint, uuid, jsonb, text) to authenticated;
grant execute on function public.submit_profile_request(uuid, uuid, uuid, bigint, jsonb) to authenticated;

revoke all on table app.saved_reports from public, anon, authenticated, service_role;
revoke all on table app.profile_requests from public, anon, authenticated, service_role;

commit;
