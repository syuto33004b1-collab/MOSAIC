begin;

-- Why an assignment was cancelled (#603). Keeping the reason for a decision is
-- a core feature (docs/PRODUCT.md, なぜを残す).
--
-- The save carries reasons in a top-level `changeReasons` key, shaped
-- generically ({entityType, entityId, action, reason}) so later kinds of "why"
-- travel the same way. The table keeps a real foreign key instead: today the
-- only pair is assignment/cancel, and a new pair adds its own column.
--
-- Contract: a reason is optional here. A cancellation without one is valid and
-- the history says "no reason recorded". The Web UI asks for one before it
-- saves; the AI chat and the external API do not send one yet (#598).

create table app.change_reasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  assignment_id uuid not null,
  action text not null check (action in ('cancel')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (organization_id, assignment_id, action, request_id),
  foreign key (organization_id, assignment_id)
    references app.assignments (organization_id, id) on delete restrict
);

create index change_reasons_assignment_idx
  on app.change_reasons (organization_id, assignment_id, created_at desc);

alter table app.change_reasons enable row level security;
alter table app.change_reasons force row level security;

revoke all on table app.change_reasons from public, anon, authenticated, service_role;

create trigger change_reasons_audit
after insert or update or delete on app.change_reasons
for each row execute function private.audit_row_change();

-- Shape and scope, checked before the core save runs. Scope is checked first
-- because archiving a member in the same save makes that person inactive, and
-- the visible set only holds active people.
create or replace function private.assert_change_reasons_allowed(
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
  v_reasons jsonb;
  v_cancel_ids text[];
  v_seen text[] := '{}'::text[];
  v_visible uuid[];
  v_item jsonb;
  v_entity text;
  v_reason text;
  v_person uuid;
begin
  if p_payload is null or not (p_payload ? 'changeReasons') then
    return;
  end if;
  v_reasons := p_payload -> 'changeReasons';
  if jsonb_typeof(v_reasons) <> 'array' then
    raise exception using errcode = '22023', message = 'changeReasons must be a JSON array';
  end if;
  if jsonb_array_length(v_reasons) > 2000 then
    raise exception using errcode = '54000', message = 'changeReasons contains more than 2000 entries';
  end if;
  if octet_length(v_reasons::text) > 1048576 then
    raise exception using errcode = '54000', message = 'changeReasons exceeds the 1 MiB limit';
  end if;

  select coalesce(array_agg(cancel_id.value #>> '{}'), '{}'::text[])
  into v_cancel_ids
  from jsonb_array_elements(
    private.payload_array(p_payload, array['assignments', 'cancelIds']::text[])
  ) as cancel_id(value);

  v_visible := private.actor_visible_active_person_ids(p_organization_id, auth.uid());

  for v_item in select value from jsonb_array_elements(v_reasons)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or (v_item - array['entityType', 'entityId', 'action', 'reason']::text[]) <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'changeReasons entries take only entityType, entityId, action, and reason';
    end if;
    if v_item ->> 'entityType' is distinct from 'assignment' or v_item ->> 'action' is distinct from 'cancel' then
      raise exception using errcode = '22023', message = 'changeReasons supports only assignment cancellations';
    end if;
    v_entity := v_item ->> 'entityId';
    if v_entity is null or not (v_entity = any (v_cancel_ids)) then
      raise exception using errcode = '22023', message = 'a change reason must name an assignment cancelled in the same save';
    end if;
    if v_entity = any (v_seen) then
      raise exception using errcode = '22023', message = 'changeReasons names an assignment more than once';
    end if;
    v_seen := v_seen || v_entity;
    if jsonb_typeof(v_item -> 'reason') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'a change reason must be between 1 and 500 characters';
    end if;
    v_reason := btrim(v_item ->> 'reason');
    if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
      raise exception using errcode = '22023', message = 'a change reason must be between 1 and 500 characters';
    end if;

    v_person := null;
    if v_entity ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select assignment.person_id
      into v_person
      from app.assignments as assignment
      where assignment.organization_id = p_organization_id
        and assignment.id = v_entity::uuid;
    end if;
    if v_person is null then
      raise exception using errcode = '22023', message = 'a change reason must name an assignment cancelled in the same save';
    end if;
    if not (v_person = any (v_visible)) then
      raise exception using errcode = '42501', message = 'this role cannot record a reason for a member outside its data scope';
    end if;
  end loop;
end;
$function$;

create or replace function private.apply_change_reasons(
  p_organization_id uuid,
  p_payload jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_payload is null or not (p_payload ? 'changeReasons') then
    return;
  end if;

  insert into app.change_reasons (
    organization_id,
    assignment_id,
    action,
    reason,
    request_id,
    created_by
  )
  select
    p_organization_id,
    (entry.item ->> 'entityId')::uuid,
    'cancel',
    btrim(entry.item ->> 'reason'),
    p_request_id,
    p_actor_user_id
  from jsonb_array_elements(p_payload -> 'changeReasons') as entry(item)
  on conflict (organization_id, assignment_id, action, request_id) do nothing;

  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'changeReasons') as entry(item)
    join app.assignments as assignment
      on assignment.organization_id = p_organization_id
     and assignment.id = (entry.item ->> 'entityId')::uuid
    where assignment.status <> 'cancelled'
  ) then
    raise exception using errcode = '22023', message = 'a change reason must name an assignment cancelled in the same save';
  end if;
end;
$function$;

revoke all on function private.assert_change_reasons_allowed(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.apply_change_reasons(uuid, jsonb, uuid, uuid) from public, anon, authenticated, service_role;

-- Same as before, except changeReasons is allowed and stripped.
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
  if (p_payload - array['members', 'projects', 'assignments', 'needs', 'skillCatalog', 'customFields', 'orgUnits', 'orgMemberships', 'opportunities', 'opportunityNeeds', 'searchScenes', 'savedReports', 'profileRequests', 'rolePermissions', 'changeReasons']::text[]) <> '{}'::jsonb then
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
  return p_payload - 'skillCatalog' - 'customFields' - 'orgUnits' - 'orgMemberships' - 'opportunities' - 'opportunityNeeds' - 'searchScenes' - 'savedReports' - 'profileRequests' - 'rolePermissions' - 'changeReasons';
end;
$function$;

-- Same as before, except changeReasons needs the assignments scope: reasons
-- travel with the assignments they explain. Unknown keys are not refused here,
-- so leaving it out would let any credential write reasons.
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
  if (p_payload ? 'assignments' or p_payload ? 'changeReasons')
     and not ('assignments:write' = any (p_client.scopes) or 'staffing:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'assignments:write is required';
  end if;
  if (p_payload ? 'needs' or p_payload ? 'opportunityNeeds')
     and not ('staffing:write' = any (p_client.scopes)) then
    raise exception using errcode = '42501', message = 'staffing:write is required';
  end if;
end;
$function$;

-- Same as before, except the change-reason check runs before the core save and
-- the write after it.
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
  perform private.assert_change_reasons_allowed(p_organization_id, p_payload);

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
  perform private.apply_change_reasons(p_organization_id, p_payload, auth.uid(), p_request_id);
  perform private.assert_skill_proficiency_matches(p_organization_id);
  return v_result;
end;
$function$;

-- Same as before, except cancelled rows carry the latest reason. Reasons are
-- judgements about a person (docs/PRODUCT.md), so only the roles that assign
-- people read them: a viewer gets the row without the keys.
create or replace function public.list_assignment_history(
  p_organization_id uuid,
  p_person_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_visible uuid[];
  v_role text;
  v_items jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_person_id is null then
    raise exception using errcode = '22023', message = 'organization and person are required';
  end if;

  -- Raises 42501 for a caller who is not an active member. A person outside
  -- the caller's scope and a person who does not exist get the same answer.
  v_visible := private.actor_visible_active_person_ids(p_organization_id, v_user_id);
  if not (p_person_id = any (v_visible)) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';

  with history as (
    select
      assignment.id,
      assignment.project_id,
      project.code as project_code,
      project.name as project_name,
      project.archived_at is not null as project_archived,
      assignment.start_date,
      assignment.end_date,
      assignment.allocation_percent,
      assignment.status,
      assignment.label,
      assignment.cancelled_at,
      assignment.cancelled_by
    from app.assignments as assignment
    join app.projects as project
      on project.organization_id = assignment.organization_id
     and project.id = assignment.project_id
    where assignment.organization_id = p_organization_id
      and assignment.person_id = p_person_id
    order by assignment.start_date desc, assignment.id
    limit 200
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', history.id,
      'projectId', history.project_id,
      'projectCode', history.project_code,
      'projectName', history.project_name,
      'projectArchived', history.project_archived,
      'startDate', history.start_date,
      'endDate', history.end_date,
      'allocation', history.allocation_percent,
      'status', history.status,
      'label', history.label,
      'cancelledAt', history.cancelled_at,
      'cancelledByName', case
        when history.cancelled_by is null then null
        else coalesce(nullif(btrim(profile.display_name), ''), 'MOSAICユーザー')
      end
    ) || case
      when v_role in ('owner', 'admin', 'planner') and history.status = 'cancelled' then jsonb_build_object(
        'cancelReason', latest_reason.reason,
        'cancelReasonAt', latest_reason.created_at,
        'cancelReasonByName', case
          when latest_reason.created_by is null then null
          else coalesce(nullif(btrim(reason_author.display_name), ''), 'MOSAICユーザー')
        end
      )
      else '{}'::jsonb
    end
    order by history.start_date desc, history.id
  ), '[]'::jsonb)
  into v_items
  from history
  left join app.profiles as profile on profile.id = history.cancelled_by
  left join lateral (
    select reason.reason, reason.created_at, reason.created_by
    from app.change_reasons as reason
    where reason.organization_id = p_organization_id
      and reason.assignment_id = history.id
      and reason.action = 'cancel'
    order by reason.created_at desc, reason.id desc
    limit 1
  ) as latest_reason on true
  left join app.profiles as reason_author on reason_author.id = latest_reason.created_by;

  return jsonb_build_object('items', v_items);
end;
$function$;

comment on function public.list_assignment_history(uuid, uuid) is $comment$
Arguments: p_organization_id uuid, p_person_id uuid.
Returns: {"items":[{"id","projectId","projectCode","projectName","projectArchived",
"startDate","endDate","allocation","status","label","cancelledAt","cancelledByName",
"cancelReason","cancelReasonAt","cancelReasonByName"}]}.
Every assignment the person ever had, cancelled ones included, newest start first,
at most 200. Readable by any active member who may see the person in the
workspace snapshot (the same personScope as get_workspace). Out of scope and
nonexistent people both raise 42501. cancelledAt is null for rows cancelled
before 20261005100000 and is not reconstructed.
The cancelReason keys appear only on cancelled rows and only for owner, admin,
and planner; a viewer's rows have no such keys. cancelReason is null when the
cancellation was saved without one.
Not part of get_workspace, and deliberately not wrapped for the external API,
the AI chat, or MCP.
$comment$;

commit;
