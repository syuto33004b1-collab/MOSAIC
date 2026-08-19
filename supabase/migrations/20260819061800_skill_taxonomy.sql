begin;

alter table app.skills
  add column if not exists kind text not null default 'skill',
  add column if not exists parent_id uuid,
  add column if not exists sort_order integer not null default 0;

alter table app.skills
  drop constraint if exists skills_kind_check,
  add constraint skills_kind_check check (kind in ('category', 'skill'));

alter table app.skills
  drop constraint if exists skills_sort_order_check,
  add constraint skills_sort_order_check check (sort_order between 0 and 10000);

alter table app.skills
  drop constraint if exists skills_parent_fk,
  add constraint skills_parent_fk
    foreign key (organization_id, parent_id)
    references app.skills (organization_id, id)
    on delete restrict;

alter table app.person_skills
  add column if not exists proficiency smallint not null default 3;

alter table app.person_skills
  drop constraint if exists person_skills_proficiency_check,
  add constraint person_skills_proficiency_check check (proficiency between 1 and 5);

alter table app.staffing_need_skills
  add column if not exists min_proficiency smallint not null default 1;

alter table app.staffing_need_skills
  drop constraint if exists staffing_need_skills_min_proficiency_check,
  add constraint staffing_need_skills_min_proficiency_check check (min_proficiency between 1 and 5);

create or replace function private.skill_has_cycle(p_organization_id uuid, p_skill_id uuid, p_parent_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  with recursive walk as (
    select p_parent_id as id, 1 as depth
    union all
    select skill.parent_id, walk.depth + 1
    from walk
    join app.skills as skill
      on skill.organization_id = p_organization_id
     and skill.id = walk.id
    where skill.parent_id is not null
      and walk.depth < 16
  )
  select exists (
    select 1 from walk where walk.id = p_skill_id
  );
$function$;

create or replace function private.guard_skill_taxonomy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_parent app.skills%rowtype;
begin
  if new.parent_id is not null then
    select *
    into v_parent
    from app.skills as skill
    where skill.organization_id = new.organization_id
      and skill.id = new.parent_id;
    if not found then
      raise exception using errcode = '23503', message = 'skill parent must belong to the same organization';
    end if;
    if v_parent.kind <> 'category' then
      raise exception using errcode = '23514', message = 'skill parent must be a category';
    end if;
    if private.skill_has_cycle(new.organization_id, new.id, new.parent_id) then
      raise exception using errcode = '23514', message = 'skill taxonomy cannot contain a cycle';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.kind = 'category' and old.kind = 'skill' then
    if exists (
      select 1 from app.person_skills as person_skill
      where person_skill.organization_id = new.organization_id
        and person_skill.skill_id = new.id
    ) or exists (
      select 1 from app.staffing_need_skills as need_skill
      where need_skill.organization_id = new.organization_id
        and need_skill.skill_id = new.id
    ) then
      raise exception using errcode = '23514', message = 'assigned skills cannot become categories';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists skills_taxonomy_guard on app.skills;
create trigger skills_taxonomy_guard
before insert or update on app.skills
for each row
execute function private.guard_skill_taxonomy();

create or replace function private.guard_assignable_skill()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from app.skills as skill
    where skill.organization_id = new.organization_id
      and skill.id = new.skill_id
      and skill.kind <> 'skill'
  ) then
    raise exception using errcode = '23514', message = 'categories cannot be assigned as skills';
  end if;
  return new;
end;
$function$;

drop trigger if exists person_skills_assignable_guard on app.person_skills;
create trigger person_skills_assignable_guard
before insert or update on app.person_skills
for each row
execute function private.guard_assignable_skill();

drop trigger if exists staffing_need_skills_assignable_guard on app.staffing_need_skills;
create trigger staffing_need_skills_assignable_guard
before insert or update on app.staffing_need_skills
for each row
execute function private.guard_assignable_skill();

create or replace function private.get_or_create_skill(
  p_organization_id uuid,
  p_name text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_name text := btrim(p_name);
  v_skill_id uuid;
  v_kind text;
begin
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'skill names must contain 1 to 80 characters';
  end if;

  select skill.id, skill.kind
  into v_skill_id, v_kind
  from app.skills as skill
  where skill.organization_id = p_organization_id
    and skill.normalized_name = lower(v_name);

  if found then
    if v_kind <> 'skill' then
      raise exception using errcode = '22023', message = 'skill name conflicts with a category';
    end if;
    return v_skill_id;
  end if;

  insert into app.skills (
    organization_id,
    name,
    kind,
    created_by,
    updated_by
  ) values (
    p_organization_id,
    v_name,
    'skill',
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_skill_id;

  return v_skill_id;
end;
$function$;

revoke all on function private.get_or_create_skill(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.skill_has_cycle(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.guard_skill_taxonomy() from public, anon, authenticated;
revoke all on function private.guard_assignable_skill() from public, anon, authenticated;

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
Returns one consistent snapshot:
{
  "organization":{"id","name","slug","workspaceRevision","workspaceChangedAt","workspaceChangedBy"},
  "skillCatalog":[{"id","name","kind","parentId","sortOrder"}],
  "members":[{"id","authUserId","employeeCode","initials","name","role","department","avatarTone","skills":[],"skillLevels":[{"name","proficiency"}],"location","capacity","isActive","version"}],
  "projects":[{"id","code","name","summary","status","tone","ownerPersonId","ownerName","ownerInitials","startDate","endDate","nextMilestone","nextMilestoneDate","progress","demand","version"}],
  "assignments":[{"id","personId","projectId","staffingNeedId","startDate","endDate","allocation","status","label","version"}],
  "needs":[{"id","projectId","role","skills":[],"skillRequirements":[{"name","minProficiency"}],"startDate","endDate","allocation","status","draftPersonId","version"}]
}
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
  if (p_payload - array['members', 'projects', 'assignments', 'needs', 'skillCatalog']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'p_payload contains unsupported top-level keys';
  end if;
  if p_payload ? 'skillCatalog' and jsonb_typeof(p_payload -> 'skillCatalog') <> 'object' then
    raise exception using errcode = '22023', message = 'skillCatalog must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'skillCatalog', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'skillCatalog contains unsupported keys';
  end if;
  return p_payload - 'skillCatalog';
end;
$function$;

create or replace function private.apply_skill_catalog(
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
  v_name text;
  v_kind text;
  v_parent uuid;
  v_sort integer;
  v_affected integer;
begin
  if not (p_payload ? 'skillCatalog') then
    return;
  end if;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['skillCatalog', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'skillCatalog.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    v_name := btrim(v_item ->> 'name');
    v_kind := coalesce(nullif(btrim(v_item ->> 'kind'), ''), 'skill');
    v_parent := nullif(v_item ->> 'parentId', '')::uuid;
    v_sort := coalesce(nullif(v_item ->> 'sortOrder', '')::integer, 0);
    if v_kind not in ('category', 'skill') then
      raise exception using errcode = '22023', message = 'skill kind must be category or skill';
    end if;
    insert into app.skills (
      id, organization_id, name, kind, parent_id, sort_order, created_by, updated_by
    ) values (
      v_id, p_organization_id, v_name, v_kind, v_parent, v_sort, p_actor_user_id, p_actor_user_id
    )
    on conflict (id) do update
    set
      name = excluded.name,
      kind = excluded.kind,
      parent_id = excluded.parent_id,
      sort_order = excluded.sort_order,
      updated_by = p_actor_user_id
    where app.skills.organization_id = p_organization_id;
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.skills as existing
      where existing.organization_id = p_organization_id
        and existing.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'skill id is not valid for this organization';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['skillCatalog', 'archiveIds']::text[]))
  loop
    v_id := (v_item #>> '{}')::uuid;
    if exists (
      select 1 from app.skills as child
      where child.organization_id = p_organization_id
        and child.parent_id = v_id
    ) then
      raise exception using errcode = '22023', message = 'skill categories with children cannot be archived';
    end if;
    if exists (
      select 1 from app.person_skills as person_skill
      where person_skill.organization_id = p_organization_id
        and person_skill.skill_id = v_id
    ) or exists (
      select 1 from app.staffing_need_skills as need_skill
      where need_skill.organization_id = p_organization_id
        and need_skill.skill_id = v_id
    ) then
      raise exception using errcode = '22023', message = 'assigned skills cannot be archived';
    end if;
    delete from app.skills as skill
    where skill.organization_id = p_organization_id
      and skill.id = v_id;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'skillCatalog.archiveIds contains an unknown id';
    end if;
  end loop;
end;
$function$;

create or replace function private.apply_skill_levels(
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
  v_level jsonb;
  v_id uuid;
  v_name text;
  v_value integer;
begin
  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['members', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item -> 'skillLevels') <> 'array' then
      continue;
    end if;
    v_id := (v_item ->> 'id')::uuid;
    for v_level in
      select value from jsonb_array_elements(v_item -> 'skillLevels')
    loop
      v_name := btrim(coalesce(v_level ->> 'name', v_level #>> '{}'));
      v_value := coalesce(nullif(v_level ->> 'proficiency', '')::integer, 3);
      if v_value not between 1 and 5 then
        raise exception using errcode = '22023', message = 'skill proficiency must be between 1 and 5';
      end if;
      update app.person_skills as person_skill
      set proficiency = v_value
      from app.skills as skill
      where person_skill.organization_id = p_organization_id
        and person_skill.person_id = v_id
        and skill.organization_id = person_skill.organization_id
        and skill.id = person_skill.skill_id
        and skill.normalized_name = lower(v_name);
    end loop;
  end loop;

  for v_item in
    select value from jsonb_array_elements(private.payload_array(p_payload, array['needs', 'upsert']::text[]))
  loop
    if jsonb_typeof(v_item -> 'skillRequirements') <> 'array' then
      continue;
    end if;
    v_id := (v_item ->> 'id')::uuid;
    for v_level in
      select value from jsonb_array_elements(v_item -> 'skillRequirements')
    loop
      v_name := btrim(coalesce(v_level ->> 'name', v_level #>> '{}'));
      v_value := coalesce(nullif(v_level ->> 'minProficiency', '')::integer, 1);
      if v_value not between 1 and 5 then
        raise exception using errcode = '22023', message = 'minimum skill proficiency must be between 1 and 5';
      end if;
      update app.staffing_need_skills as need_skill
      set min_proficiency = v_value
      from app.skills as skill
      where need_skill.organization_id = p_organization_id
        and need_skill.staffing_need_id = v_id
        and skill.organization_id = need_skill.organization_id
        and skill.id = need_skill.skill_id
        and skill.normalized_name = lower(v_name);
    end loop;
  end loop;
end;
$function$;

create or replace function private.assert_skill_proficiency_matches(p_organization_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from app.staffing_needs as need
    where need.organization_id = p_organization_id
      and need.status in ('planned', 'filled')
      and exists (
        select 1
        from app.staffing_need_skills as required_skill
        left join app.person_skills as qualified_skill
          on qualified_skill.organization_id = need.organization_id
         and qualified_skill.person_id = need.draft_person_id
         and qualified_skill.skill_id = required_skill.skill_id
         and qualified_skill.proficiency >= required_skill.min_proficiency
        where required_skill.organization_id = need.organization_id
          and required_skill.staffing_need_id = need.id
          and qualified_skill.person_id is null
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'planned or filled staffing needs require one matching active assignment and qualified draft person';
  end if;
end;
$function$;

do $rename$
begin
  if to_regprocedure('public.save_workspace(uuid,bigint,uuid,jsonb,text)') is not null
     and to_regprocedure('private.save_workspace_core(uuid,bigint,uuid,jsonb,text)') is null then
    alter function public.save_workspace(uuid, bigint, uuid, jsonb, text)
      rename to save_workspace_core;
    alter function public.save_workspace_core(uuid, bigint, uuid, jsonb, text)
      set schema private;
  end if;
end;
$rename$;

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

Payload shape is the existing members/projects/assignments/needs contract, plus:
{
  "skillCatalog": {
    "upsert": [{"id","name","kind","parentId?","sortOrder?"}],
    "archiveIds": ["uuid"]
  },
  "members.upsert[].skillLevels": [{"name","proficiency"}],
  "needs.upsert[].skillRequirements": [{"name","minProficiency"}]
}
skills arrays remain string names for compatibility. Proficiency is 1-5.
$comment$;

revoke all on function private.workspace_core_payload(jsonb) from public, anon, authenticated;
revoke all on function private.apply_skill_catalog(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.apply_skill_levels(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.assert_skill_proficiency_matches(uuid) from public, anon, authenticated;
revoke all on function private.save_workspace_core(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.save_workspace(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.get_workspace(uuid) from public, anon, authenticated;

grant execute on function public.get_workspace(uuid) to authenticated;
grant execute on function public.save_workspace(uuid, bigint, uuid, jsonb, text) to authenticated;

commit;
