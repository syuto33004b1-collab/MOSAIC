begin;

-- Evaluations of a person, written in free text by the people who assign and
-- evaluate (#601). They are judgements about a person, so they never ride on
-- the workspace snapshot: get_workspace feeds the AI chat (an external LLM),
-- the external API, and MCP. Only the dedicated RPCs below read or write them,
-- each deciding access itself, and none of them is wrapped for those paths.
--
-- Who may do what (the subject never, a viewer never):
--   write     owner/admin/planner, about someone in their scope, not themselves
--   read      visibility 'assigners': owner/admin/planner in scope
--             visibility 'managers':  owner/admin, the author, the subject's managers
--   edit      the author, until withdrawn
--   withdraw  the author, or owner/admin; a reason is required
-- A withdrawn evaluation keeps its text for the owner and the author only.

create table app.person_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  request_id uuid not null,
  person_id uuid not null,
  project_id uuid,
  observed_on date not null,
  strengths text check (strengths is null or char_length(btrim(strengths)) between 1 and 2000),
  concerns text check (concerns is null or char_length(btrim(concerns)) between 1 and 2000),
  basis text check (basis is null or char_length(btrim(basis)) between 1 and 2000),
  visibility text not null default 'assigners' check (visibility in ('assigners', 'managers')),
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users (id) on delete set null,
  withdrawn_reason text check (withdrawn_reason is null or char_length(btrim(withdrawn_reason)) between 1 and 500),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (strengths is not null or concerns is not null),
  check (concerns is null or basis is not null),
  check ((withdrawn_at is null) = (withdrawn_reason is null)),
  unique (organization_id, id),
  unique (organization_id, request_id),
  foreign key (organization_id, person_id)
    references app.people (organization_id, id) on delete restrict,
  foreign key (organization_id, project_id)
    references app.projects (organization_id, id) on delete restrict
);

create index person_evaluations_person_idx
  on app.person_evaluations (organization_id, person_id, observed_on desc, created_at desc);

alter table app.person_evaluations enable row level security;
alter table app.person_evaluations force row level security;

revoke all on table app.person_evaluations from public, anon, authenticated, service_role;

create trigger person_evaluations_touch
before insert or update on app.person_evaluations
for each row execute function private.touch_versioned_row();

create trigger person_evaluations_audit
after insert or update or delete on app.person_evaluations
for each row execute function private.audit_row_change();

-- People the caller manages: everyone with a membership (primary or not) in a
-- unit the caller's own person row manages, or below it. A manager flag makes
-- someone a reader of 'managers' evaluations, so it only counts for an active
-- member who may also write them (owner/admin/planner); a viewer who manages a
-- unit reads nothing. The unit walk is capped at the org-unit cycle guard depth.
create or replace function private.managed_person_ids(
  p_organization_id uuid,
  p_user_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  with recursive caller_units as (
    select membership.org_unit_id as id, 1 as depth
    from app.person_org_units as membership
    join app.people as person
      on person.organization_id = membership.organization_id
     and person.id = membership.person_id
    where membership.organization_id = p_organization_id
      and membership.is_manager
      and person.user_id = p_user_id
      and person.is_active
      and exists (
        select 1
        from app.organization_memberships as org_membership
        where org_membership.organization_id = p_organization_id
          and org_membership.user_id = p_user_id
          and org_membership.status = 'active'
          and org_membership.role in ('owner', 'admin', 'planner')
      )
    union all
    select child.id, caller_units.depth + 1
    from caller_units
    join app.org_units as child
      on child.organization_id = p_organization_id
     and child.parent_id = caller_units.id
    where caller_units.depth < 16
  )
  select coalesce(array_agg(distinct membership.person_id), '{}'::uuid[])
  from app.person_org_units as membership
  where membership.organization_id = p_organization_id
    and membership.org_unit_id in (select caller_units.id from caller_units);
$function$;

revoke all on function private.managed_person_ids(uuid, uuid) from public, anon, authenticated, service_role;

-- The caller's role when the person is someone the caller may evaluate or
-- read about, otherwise 42501. One answer for out of scope, nonexistent,
-- viewer, and the subject themselves, so the response does not tell them apart.
create or replace function private.evaluation_actor_role(
  p_organization_id uuid,
  p_person_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_visible uuid[];
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  v_visible := private.actor_visible_active_person_ids(p_organization_id, v_user_id);
  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';
  if v_role is null
     or v_role not in ('owner', 'admin', 'planner')
     or p_person_id is null
     or not (p_person_id = any (v_visible))
     or exists (
       select 1
       from app.people as person
       where person.organization_id = p_organization_id
         and person.id = p_person_id
         and person.user_id = v_user_id
     ) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return v_role;
end;
$function$;

revoke all on function private.evaluation_actor_role(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.list_person_evaluations(
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
  v_role text;
  v_manager boolean;
  v_items jsonb;
begin
  if p_organization_id is null or p_person_id is null then
    raise exception using errcode = '22023', message = 'organization and person are required';
  end if;
  v_role := private.evaluation_actor_role(p_organization_id, p_person_id);
  v_manager := p_person_id = any (private.managed_person_ids(p_organization_id, v_user_id));

  with readable as (
    select evaluation.*
    from app.person_evaluations as evaluation
    where evaluation.organization_id = p_organization_id
      and evaluation.person_id = p_person_id
      and (
        evaluation.visibility = 'assigners'
        or v_role in ('owner', 'admin')
        or evaluation.created_by = v_user_id
        or v_manager
      )
    order by evaluation.observed_on desc, evaluation.created_at desc, evaluation.id
    limit 200
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', readable.id,
      'version', readable.version,
      'personId', readable.person_id,
      'projectId', readable.project_id,
      'projectName', project.name,
      'observedOn', readable.observed_on,
      'visibility', readable.visibility,
      'authorName', coalesce(nullif(btrim(author.display_name), ''), 'MOSAICユーザー'),
      'createdAt', readable.created_at,
      'updatedAt', readable.updated_at,
      'mine', readable.created_by = v_user_id,
      'canEdit', readable.created_by = v_user_id and readable.withdrawn_at is null,
      'canWithdraw', readable.withdrawn_at is null and (readable.created_by = v_user_id or v_role in ('owner', 'admin'))
    ) || case
      when readable.withdrawn_at is null or v_role = 'owner' or readable.created_by = v_user_id then jsonb_build_object(
        'strengths', readable.strengths,
        'concerns', readable.concerns,
        'basis', readable.basis
      )
      else '{}'::jsonb
    end || case
      when readable.withdrawn_at is null then jsonb_build_object('withdrawn', null)
      else jsonb_build_object('withdrawn', jsonb_build_object(
        'at', readable.withdrawn_at,
        'byName', coalesce(nullif(btrim(withdrawer.display_name), ''), 'MOSAICユーザー'),
        'reason', readable.withdrawn_reason
      ))
    end
    order by readable.observed_on desc, readable.created_at desc, readable.id
  ), '[]'::jsonb)
  into v_items
  from readable
  left join app.projects as project
    on project.organization_id = readable.organization_id
   and project.id = readable.project_id
  left join app.profiles as author on author.id = readable.created_by
  left join app.profiles as withdrawer on withdrawer.id = readable.withdrawn_by;

  return jsonb_build_object('items', v_items, 'canWrite', true);
end;
$function$;

create or replace function public.save_person_evaluation(
  p_organization_id uuid,
  p_request_id uuid,
  p_evaluation jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_person_id uuid;
  v_project_id uuid;
  v_observed_on date;
  v_strengths text;
  v_concerns text;
  v_basis text;
  v_visibility text;
  v_expected bigint;
  v_existing app.person_evaluations%rowtype;
  v_saved app.person_evaluations%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'organization and request id are required';
  end if;
  if p_evaluation is null or jsonb_typeof(p_evaluation) <> 'object'
     or (p_evaluation - array['id', 'expectedVersion', 'personId', 'projectId', 'observedOn', 'strengths', 'concerns', 'basis', 'visibility']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'p_evaluation takes only id, expectedVersion, personId, projectId, observedOn, strengths, concerns, basis, and visibility';
  end if;

  if not coalesce(p_evaluation ->> 'personId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  v_person_id := (p_evaluation ->> 'personId')::uuid;
  perform private.evaluation_actor_role(p_organization_id, v_person_id);

  v_strengths := nullif(btrim(coalesce(p_evaluation ->> 'strengths', '')), '');
  v_concerns := nullif(btrim(coalesce(p_evaluation ->> 'concerns', '')), '');
  v_basis := nullif(btrim(coalesce(p_evaluation ->> 'basis', '')), '');
  v_visibility := coalesce(p_evaluation ->> 'visibility', 'assigners');
  if v_strengths is null and v_concerns is null then
    raise exception using errcode = '22023', message = 'an evaluation needs strengths or concerns';
  end if;
  if v_concerns is not null and v_basis is null then
    raise exception using errcode = '22023', message = 'concerns need the reason and the scene they come from';
  end if;
  if char_length(coalesce(v_strengths, '')) > 2000 or char_length(coalesce(v_concerns, '')) > 2000 or char_length(coalesce(v_basis, '')) > 2000 then
    raise exception using errcode = '22023', message = 'each evaluation text is at most 2000 characters';
  end if;
  if v_visibility not in ('assigners', 'managers') then
    raise exception using errcode = '22023', message = 'visibility must be assigners or managers';
  end if;
  if coalesce(p_evaluation ->> 'observedOn', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = '22023', message = 'observedOn must be a date';
  end if;
  v_observed_on := (p_evaluation ->> 'observedOn')::date;
  if nullif(p_evaluation ->> 'projectId', '') is not null then
    if not (p_evaluation ->> 'projectId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'projectId is not a project of this organization';
    end if;
    v_project_id := (p_evaluation ->> 'projectId')::uuid;
    if not exists (
      select 1 from app.projects as project
      where project.organization_id = p_organization_id and project.id = v_project_id
    ) then
      raise exception using errcode = '22023', message = 'projectId is not a project of this organization';
    end if;
  end if;

  perform set_config('app.request_id', p_request_id::text, true);

  if nullif(p_evaluation ->> 'id', '') is null then
    select evaluation.*
    into v_existing
    from app.person_evaluations as evaluation
    where evaluation.organization_id = p_organization_id
      and evaluation.request_id = p_request_id;
    if found then
      if v_existing.created_by is distinct from v_user_id then
        raise exception using errcode = '42501', message = 'not authorized';
      end if;
      return jsonb_build_object('id', v_existing.id, 'version', v_existing.version, 'replayed', true);
    end if;

    insert into app.person_evaluations (
      organization_id, request_id, person_id, project_id, observed_on,
      strengths, concerns, basis, visibility, created_by, updated_by
    ) values (
      p_organization_id, p_request_id, v_person_id, v_project_id, v_observed_on,
      v_strengths, v_concerns, v_basis, v_visibility, v_user_id, v_user_id
    )
    returning * into v_saved;
    return jsonb_build_object('id', v_saved.id, 'version', v_saved.version, 'replayed', false);
  end if;

  if not (p_evaluation ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  v_id := (p_evaluation ->> 'id')::uuid;
  select evaluation.*
  into v_existing
  from app.person_evaluations as evaluation
  where evaluation.organization_id = p_organization_id
    and evaluation.id = v_id
  for update;
  if not found
     or v_existing.person_id <> v_person_id
     or v_existing.created_by is distinct from v_user_id
     or v_existing.withdrawn_at is not null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if coalesce(p_evaluation ->> 'expectedVersion', '') !~ '^\d+$' then
    raise exception using errcode = '22023', message = 'expectedVersion is required to change an evaluation';
  end if;
  v_expected := (p_evaluation ->> 'expectedVersion')::bigint;
  if v_existing.version <> v_expected then
    raise exception using errcode = '40001', message = 'evaluation was changed since it was read';
  end if;

  update app.person_evaluations as evaluation
  set
    project_id = v_project_id,
    observed_on = v_observed_on,
    strengths = v_strengths,
    concerns = v_concerns,
    basis = v_basis,
    visibility = v_visibility,
    updated_by = v_user_id
  where evaluation.organization_id = p_organization_id
    and evaluation.id = v_id
  returning * into v_saved;
  return jsonb_build_object('id', v_saved.id, 'version', v_saved.version, 'replayed', false);
end;
$function$;

create or replace function public.withdraw_person_evaluation(
  p_organization_id uuid,
  p_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_request_id uuid
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
  v_reason text := btrim(coalesce(p_reason, ''));
  v_existing app.person_evaluations%rowtype;
  v_saved app.person_evaluations%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'organization, evaluation, and request id are required';
  end if;

  select evaluation.*
  into v_existing
  from app.person_evaluations as evaluation
  where evaluation.organization_id = p_organization_id
    and evaluation.id = p_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  v_role := private.evaluation_actor_role(p_organization_id, v_existing.person_id);
  if v_existing.created_by is distinct from v_user_id and v_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  if v_existing.withdrawn_at is not null then
    return jsonb_build_object('id', v_existing.id, 'version', v_existing.version, 'replayed', true);
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'a withdrawal reason must be between 1 and 500 characters';
  end if;
  if p_expected_version is null or v_existing.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'evaluation was changed since it was read';
  end if;

  perform set_config('app.request_id', p_request_id::text, true);
  update app.person_evaluations as evaluation
  set
    withdrawn_at = now(),
    withdrawn_by = v_user_id,
    withdrawn_reason = v_reason,
    updated_by = v_user_id
  where evaluation.organization_id = p_organization_id
    and evaluation.id = p_id
  returning * into v_saved;
  return jsonb_build_object('id', v_saved.id, 'version', v_saved.version, 'replayed', false);
end;
$function$;

comment on function public.list_person_evaluations(uuid, uuid) is $comment$
Arguments: p_organization_id uuid, p_person_id uuid.
Returns: {"items":[{"id","version","personId","projectId","projectName","observedOn","visibility",
"authorName","createdAt","updatedAt","mine","canEdit","canWithdraw","strengths","concerns","basis",
"withdrawn":null|{"at","byName","reason"}}],"canWrite":true}.
For owner/admin/planner about a person in their scope who is not themselves; anyone else,
including the subject and a viewer, gets 42501, the same as for a person who does not exist.
'managers' evaluations are listed only for owner/admin, the author, and the subject's managers.
A withdrawn evaluation lists strengths/concerns/basis only for the owner and the author.
Newest observation first, at most 200. Not part of get_workspace, and deliberately not
wrapped for the external API, the AI chat, or MCP.
$comment$;

comment on function public.save_person_evaluation(uuid, uuid, jsonb) is $comment$
Arguments: p_organization_id uuid, p_request_id uuid, p_evaluation jsonb
{"id?","expectedVersion?","personId","projectId?","observedOn","strengths?","concerns?","basis?","visibility?"}.
Returns: {"id","version","replayed"}.
Without id it creates (owner/admin/planner, a person in scope, not oneself); the same request id
replays for its author. With id it updates the caller's own evaluation, before it is withdrawn,
at expectedVersion (40001 otherwise). Strengths or concerns is required; concerns need basis.
An id the caller may not change and an id that does not exist both raise 42501.
$comment$;

comment on function public.withdraw_person_evaluation(uuid, uuid, bigint, text, uuid) is $comment$
Arguments: p_organization_id uuid, p_id uuid, p_expected_version bigint, p_reason text (1-500), p_request_id uuid.
Returns: {"id","version","replayed"}.
The author, or an owner/admin who may read the person, withdraws with a reason. Withdrawing an
already withdrawn evaluation replays. Nothing is deleted.
$comment$;

revoke all on function public.list_person_evaluations(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_person_evaluations(uuid, uuid) to authenticated;
revoke all on function public.save_person_evaluation(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_person_evaluation(uuid, uuid, jsonb) to authenticated;
revoke all on function public.withdraw_person_evaluation(uuid, uuid, bigint, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_person_evaluation(uuid, uuid, bigint, text, uuid) to authenticated;

-- Same as before, except the text of an evaluation is left out of the audit
-- rows for everyone but the owner, and always for an integration: an admin's
-- personScope must not be crossed by reading the audit instead.
create or replace function public.list_audit_events(
  p_organization_id uuid,
  p_limit integer default 50,
  p_before bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer := coalesce(p_limit, 50);
  v_result jsonb;
  v_user_id uuid := auth.uid();
  v_role text;
  v_hidden text[] := '{}'::text[];
  v_may_see_cost boolean;
  v_may_see_evaluations boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_limit < 1 or v_limit > 200 then
    raise exception using errcode = '22023', message = 'p_limit must be between 1 and 200';
  end if;

  select membership.role
  into v_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';

  if v_role <> 'owner' then
    select permission.hidden_field_keys
    into v_hidden
    from app.role_permissions as permission
    where permission.organization_id = p_organization_id
      and permission.role = v_role;
    if not found then
      v_hidden := '{}'::text[];
    end if;
  end if;

  v_may_see_cost :=
    coalesce(nullif(current_setting('app.caller_kind', true), ''), 'user') <> 'integration'
    and (
      v_role = 'owner'
      or (v_role = 'admin' and not ('monthlyCost' = any (v_hidden)))
    );
  v_may_see_evaluations :=
    coalesce(nullif(current_setting('app.caller_kind', true), ''), 'user') <> 'integration'
    and v_role = 'owner';

  with page as (
    select audit.*
    from app.audit_events as audit
    where audit.organization_id = p_organization_id
      and (p_before is null or audit.id < p_before)
    order by audit.id desc
    limit v_limit
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'occurredAt', page.occurred_at,
        'actorUserId', page.actor_user_id,
        'actorName', actor.display_name,
        'action', page.action,
        'entityType', page.entity_type,
        'entityId', page.entity_id,
        'entityKey', page.entity_key,
        'requestId', page.request_id,
        'workspaceRevision', page.workspace_revision,
        'oldData', case
          when page.entity_type = 'person_evaluations' and not v_may_see_evaluations
            then page.old_data - array['strengths', 'concerns', 'basis', 'withdrawn_reason']::text[]
          when v_may_see_cost then page.old_data
          else page.old_data - 'monthly_cost_yen'
        end,
        'newData', case
          when page.entity_type = 'person_evaluations' and not v_may_see_evaluations
            then page.new_data - array['strengths', 'concerns', 'basis', 'withdrawn_reason']::text[]
          when v_may_see_cost then page.new_data
          else page.new_data - 'monthly_cost_yen'
        end,
        'callerKind', page.caller_kind,
        'integrationClientId', page.integration_client_id,
        'integrationClientName', integration_client.name
      ) order by page.id desc
    ), '[]'::jsonb),
    'nextBefore', case when count(page.id) = v_limit then min(page.id) else null end
  )
  into v_result
  from page
  left join app.profiles as actor on actor.id = page.actor_user_id
  left join app.integration_clients as integration_client
    on integration_client.id = page.integration_client_id;

  return v_result;
end;
$function$;

comment on function public.list_audit_events(uuid, integer, bigint) is $comment$
Arguments: p_organization_id uuid, p_limit integer (1..200), p_before bigint cursor (exclusive).
Returns items with callerKind (user|ai|integration) and optional integration client identity.
Only owners and admins may read audit events. Secrets are never included.
monthly_cost_yen is omitted from oldData/newData unless the caller may see monthlyCost
(owner, or admin without that key hidden). Integration callers never receive it.
For person_evaluations, strengths/concerns/basis/withdrawn_reason are omitted unless the caller
is the owner; integration callers never receive them.
$comment$;

commit;
