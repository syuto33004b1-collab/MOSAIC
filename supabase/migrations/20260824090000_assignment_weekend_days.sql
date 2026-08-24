-- Weekend work, recorded as the days it happened on (#222).
--
-- #207 gave the board its Saturday and Sunday columns but changed no figures, and
-- the measurement is why: an assignment carries a date range and no working days,
-- and 12 of the 15 in the seed span a weekend simply by lasting more than a week.
-- Counting those weekends would have put 鈴木健太 at 120% on a Saturday nobody
-- works.
--
-- So the weekend is opt-in, one date at a time. A row here means 「this assignment
-- was worked on this weekend day」. The weekday ceiling does not move: 100% is
-- still five weekdays, `totalCapacity` is still 稼働上限 × 5, and 空き人日 still
-- counts weekdays only — weekend work shows up as the excess it is.
--
-- Dates, not a weekday pattern. 「every Saturday for three months」 and 「the 22nd」
-- are different claims, and a pattern makes the first one silently mean thirteen
-- Saturdays. Choosing dates was the user's decision.

create table app.assignment_weekend_days (
  organization_id uuid not null,
  assignment_id uuid not null,
  work_date date not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (organization_id, assignment_id, work_date),
  foreign key (organization_id, assignment_id)
    references app.assignments (organization_id, id) on delete cascade,
  -- Saturday and Sunday only. The table is named for the weekend and the whole
  -- contract reads that way; letting a Tuesday in here would make 「worked the
  -- weekend」 mean something else. A public holiday is a different concept — it
  -- moves the weekday ceiling too — and belongs in its own table when it comes.
  constraint assignment_weekend_days_weekend_only
    check (extract(isodow from work_date) in (6, 7))
);

comment on table app.assignment_weekend_days is $comment$
Weekend days an assignment was actually worked. Weekday capacity is unchanged by
these rows; they are the excess above it (#222).
$comment$;

-- No index on (organization_id, assignment_id): that is the primary key's own
-- prefix, and a second copy of it buys nothing.
-- Load is read per person over a date span, and the parent is what carries the
-- person, so this is the index the daily loop actually walks.
create index assignment_weekend_days_date_idx
  on app.assignment_weekend_days (organization_id, work_date);

alter table app.assignment_weekend_days enable row level security;
alter table app.assignment_weekend_days force row level security;

create policy assignment_weekend_days_select_member on app.assignment_weekend_days
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

/*
 * Inside the parent's range, enforced twice.
 *
 * The RPC checks it first so a person gets a sentence rather than a constraint
 * name, and this is the line that holds when something else writes: a weekend day
 * outside its assignment's dates is not a fact about anything. `for share` on the
 * parent, because a concurrent transaction shortening the range would otherwise
 * commit a row this one just validated.
 */
create or replace function private.assert_weekend_day_in_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_start date;
  v_end date;
begin
  select assignment.start_date, assignment.end_date
  into v_start, v_end
  from app.assignments as assignment
  where assignment.organization_id = new.organization_id
    and assignment.id = new.assignment_id
  for share;

  if not found then
    raise exception using errcode = '23503', message = 'weekend day references an unknown assignment';
  end if;
  if new.work_date < v_start or new.work_date > v_end then
    raise exception using errcode = '22023',
      message = format('weekend day %s is outside the assignment %s..%s', new.work_date, v_start, v_end);
  end if;
  return new;
end;
$function$;

/*
 * And the other direction: shortening an assignment drops the weekend days it no
 * longer covers. Without this they survive out of range and come back the moment
 * the range is widened again — the same 「stale setting reappears」 shape the
 * evaluation warned about.
 */
create or replace function private.prune_weekend_days_outside_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.start_date is not distinct from old.start_date
    and new.end_date is not distinct from old.end_date then
    return new;
  end if;
  delete from app.assignment_weekend_days as weekend_day
  where weekend_day.organization_id = new.organization_id
    and weekend_day.assignment_id = new.id
    and (weekend_day.work_date < new.start_date or weekend_day.work_date > new.end_date);
  return new;
end;
$function$;

revoke all on function private.assert_weekend_day_in_assignment() from public, anon, authenticated;
revoke all on function private.prune_weekend_days_outside_assignment() from public, anon, authenticated;

create trigger assignment_weekend_days_in_range
before insert or update on app.assignment_weekend_days
for each row execute function private.assert_weekend_day_in_assignment();

create trigger assignments_prune_weekend_days
after update on app.assignments
for each row execute function private.prune_weekend_days_outside_assignment();


/*
 * The audit trigger, re-declared for the new table's key. Every child table has
 * a branch here; without one the row would be logged with a null entity.
 */

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

create trigger assignment_weekend_days_audit
after insert or update or delete on app.assignment_weekend_days
for each row execute function private.audit_row_change();


/*
 * The weekend days of each assignment in the payload, synced.
 *
 * Three-valued on purpose, and deliberately unlike `member.skills` next door,
 * which clears itself when the key is absent:
 *
 *   key absent  → leave the rows alone
 *   `[]`        → clear them
 *   `null`      → an error, because it is not a way to say either
 *
 * The reason is the whole-workspace save. A client that has not learned the field
 * yet — the external API, an MCP write — sends every assignment back without it,
 * and 「absent means clear」 would delete a person's weekend work as a side effect
 * of an unrelated edit. The evaluation on #222 raised this before it shipped.
 *
 * Runs after `save_workspace_core`, like every other `apply_*`, so the parent rows
 * exist for the foreign key.
 */
create or replace function private.apply_assignment_weekend_days(
  p_organization_id uuid,
  p_payload jsonb,
  p_user_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_id uuid;
  v_dates jsonb;
  v_date text;
begin
  for v_item in
    select value from jsonb_array_elements(
      private.payload_array(p_payload, array['assignments', 'upsert']::text[])
    )
  loop
    if not (v_item ? 'weekendWorkDates') then
      continue;
    end if;
    v_dates := v_item -> 'weekendWorkDates';
    if jsonb_typeof(v_dates) <> 'array' then
      raise exception using errcode = '22023',
        message = 'assignments.upsert[].weekendWorkDates must be an array of YYYY-MM-DD strings';
    end if;
    v_id := (v_item ->> 'id')::uuid;

    -- Calendar days, compared as dates. No time zone enters this: the strings are
    -- 'YYYY-MM-DD' and stay that way.
    delete from app.assignment_weekend_days as weekend_day
    where weekend_day.organization_id = p_organization_id
      and weekend_day.assignment_id = v_id
      and not exists (
        select 1
        from jsonb_array_elements_text(v_dates) as wanted(value)
        where wanted.value::date = weekend_day.work_date
      );

    for v_date in select value from jsonb_array_elements_text(v_dates)
    loop
      if v_date is null or v_date !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception using errcode = '22023',
          message = 'assignments.upsert[].weekendWorkDates entries must be YYYY-MM-DD';
      end if;
      insert into app.assignment_weekend_days (
        organization_id,
        assignment_id,
        work_date,
        created_by
      ) values (
        p_organization_id,
        v_id,
        v_date::date,
        p_user_id
      ) on conflict do nothing;
    end loop;
  end loop;
end;
$function$;

revoke all on function private.apply_assignment_weekend_days(uuid, jsonb, uuid) from public, anon, authenticated;


-- One `perform` more than the definition it replaces.

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
  -- After the core save, so the assignments these hang off exist (#222).
  perform private.apply_assignment_weekend_days(p_organization_id, p_payload, auth.uid());
  perform private.assert_skill_proficiency_matches(p_organization_id);
  return v_result;
end;
$function$;

-- One key more, on each assignment.

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
