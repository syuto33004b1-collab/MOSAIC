-- Periods when a person's weekday ceiling is lower than people.capacity_percent
-- (#323). Nested on members, not a top-level payload key: personScope already
-- filters the member list, and a sibling array would leak people the caller
-- cannot see.
--
-- Three-valued like weekendWorkDates and workHistory:
--   key absent  → leave the rows alone
--   `[]`        → clear them
--   `null`      → an error
--
-- The weekday holiday calendar is a function in the app, not a table. A CHECK
-- here cannot name 振替休日.

create table app.person_unavailability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  person_id uuid not null,
  start_date date not null,
  end_date date not null,
  capacity_percent numeric(5, 2) not null
    check (capacity_percent >= 0 and capacity_percent <= 100),
  note text not null default '' check (char_length(note) <= 80),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  foreign key (organization_id, person_id)
    references app.people (organization_id, id)
    on delete cascade,
  constraint person_unavailability_ordered check (end_date >= start_date)
);

create index person_unavailability_person_idx
  on app.person_unavailability (organization_id, person_id, start_date);

alter table app.person_unavailability enable row level security;
alter table app.person_unavailability force row level security;

create policy person_unavailability_select_member on app.person_unavailability
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create trigger person_unavailability_touch
before insert or update on app.person_unavailability
for each row execute function private.touch_versioned_row();

create trigger person_unavailability_audit
after insert or update or delete on app.person_unavailability
for each row execute function private.audit_row_change();

create or replace function private.apply_person_unavailability(
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
  v_rows jsonb;
begin
  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['members', 'upsert']::text[]))
  loop
    if not (v_item ? 'unavailability') then
      continue;
    end if;
    v_rows := v_item -> 'unavailability';
    if jsonb_typeof(v_rows) <> 'array' then
      raise exception using errcode = '22023',
        message = 'members.upsert[].unavailability must be a JSON array';
    end if;
    if jsonb_array_length(v_rows) > 50 then
      raise exception using errcode = '22023',
        message = 'members.upsert[].unavailability may have at most 50 rows';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    delete from app.person_unavailability as leave
    where leave.organization_id = p_organization_id
      and leave.person_id = v_id;

    for v_entry in
      select value from jsonb_array_elements(v_rows)
    loop
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception using errcode = '22023',
          message = 'members.upsert[].unavailability entries must be objects';
      end if;
      if coalesce(v_entry ->> 'note', '') <> ''
         and char_length(v_entry ->> 'note') > 80 then
        raise exception using errcode = '22023',
          message = 'members.upsert[].unavailability note must be 80 characters or fewer';
      end if;
      insert into app.person_unavailability (
        id, organization_id, person_id, start_date, end_date, capacity_percent, note, created_by, updated_by
      ) values (
        (v_entry ->> 'id')::uuid,
        p_organization_id,
        v_id,
        (v_entry ->> 'startDate')::date,
        (v_entry ->> 'endDate')::date,
        (v_entry ->> 'capacityPercent')::numeric,
        coalesce(v_entry ->> 'note', ''),
        p_actor_user_id,
        p_actor_user_id
      );
    end loop;
  end loop;
end;
$function$;

revoke all on function private.apply_person_unavailability(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on table app.person_unavailability from public, anon, authenticated, service_role;
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
