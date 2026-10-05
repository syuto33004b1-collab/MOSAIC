begin;

-- Assignment history (#600). A cancelled assignment keeps its row (soft
-- cancel), but get_workspace drops it, so nobody could see that a person was
-- once planned onto a project. This adds when and by whom it was cancelled and
-- a person-scoped read of every assignment the person ever had.
--
-- Rows cancelled before this migration keep null in both columns. Their
-- cancellation time is not reconstructed from audit_events or updated_at: a
-- missing record is shown as missing, not guessed (docs/PRODUCT.md, なぜを残す).

alter table app.assignments
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users (id) on delete set null;

-- Stamps the transition into cancelled on every write path (Web UI, AI chat,
-- external API) without touching private.save_workspace_core. Once stamped the
-- values do not move while the row stays cancelled; leaving cancelled clears
-- them so an old cancellation time cannot outlive a reinstated assignment.
create or replace function private.stamp_assignment_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'cancelled' then
    if tg_op = 'UPDATE' and old.status = 'cancelled' then
      new.cancelled_at := old.cancelled_at;
      new.cancelled_by := old.cancelled_by;
    else
      new.cancelled_at := now();
      new.cancelled_by := coalesce(auth.uid(), new.updated_by);
    end if;
  else
    new.cancelled_at := null;
    new.cancelled_by := null;
  end if;
  return new;
end;
$function$;

revoke all on function private.stamp_assignment_cancellation() from public, anon, authenticated, service_role;

create trigger assignments_cancellation_stamp
before insert or update on app.assignments
for each row execute function private.stamp_assignment_cancellation();

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
    ) order by history.start_date desc, history.id
  ), '[]'::jsonb)
  into v_items
  from history
  left join app.profiles as profile on profile.id = history.cancelled_by;

  return jsonb_build_object('items', v_items);
end;
$function$;

comment on function public.list_assignment_history(uuid, uuid) is $comment$
Arguments: p_organization_id uuid, p_person_id uuid.
Returns: {"items":[{"id","projectId","projectCode","projectName","projectArchived",
"startDate","endDate","allocation","status","label","cancelledAt","cancelledByName"}]}.
Every assignment the person ever had, cancelled ones included, newest start first,
at most 200. Readable by any active member who may see the person in the
workspace snapshot (the same personScope as get_workspace). Out of scope and
nonexistent people both raise 42501. cancelledAt is null for rows cancelled
before 20261005100000 and is not reconstructed.
Not part of get_workspace, and deliberately not wrapped for the external API,
the AI chat, or MCP.
$comment$;

revoke all on function public.list_assignment_history(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_assignment_history(uuid, uuid) to authenticated;

commit;
