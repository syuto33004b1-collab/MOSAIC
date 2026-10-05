begin;

-- What a person said they want and want to avoid, written down by the person
-- who heard it in a 1on1 or an interview (#610). The screen calls it 志向.
-- It is kept apart from evaluations (#601): those are the writer's judgement,
-- these are the person's own words as heard. Like evaluations they never ride
-- on the workspace snapshot, which feeds the AI chat, the external API, and MCP.
--
-- Who may do what is exactly the 'assigners' evaluation rule, decided by
-- private.evaluation_actor_role, which this file does not change:
--   write     owner/admin/planner, about someone in their scope, not themselves
--   read      owner/admin/planner in scope (the subject never, a viewer never)
--   edit      the author, until withdrawn
--   withdraw  the author, or owner/admin; a reason is required
-- A withdrawn record keeps its text for the owner and the author only.
--
-- Every row here was heard by its author. When the person can write their own
-- (it needs people linked to logins first), that path gets its own predicate
-- beside evaluation_actor_role rather than a looser evaluation_actor_role, and
-- a source column whose backfill for these rows is 'heard'.

create table app.person_aspirations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  request_id uuid not null,
  person_id uuid not null,
  heard_on date not null,
  context text check (context is null or char_length(btrim(context)) between 1 and 200),
  wishes text check (wishes is null or char_length(btrim(wishes)) between 1 and 1000),
  avoids text check (avoids is null or char_length(btrim(avoids)) between 1 and 1000),
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users (id) on delete set null,
  withdrawn_reason text check (withdrawn_reason is null or char_length(btrim(withdrawn_reason)) between 1 and 500),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (wishes is not null or avoids is not null),
  check ((withdrawn_at is null) = (withdrawn_reason is null)),
  unique (organization_id, id),
  unique (organization_id, request_id),
  foreign key (organization_id, person_id)
    references app.people (organization_id, id) on delete restrict
);

create index person_aspirations_person_idx
  on app.person_aspirations (organization_id, person_id, heard_on desc, created_at desc);

alter table app.person_aspirations enable row level security;
alter table app.person_aspirations force row level security;

revoke all on table app.person_aspirations from public, anon, authenticated, service_role;

create trigger person_aspirations_touch
before insert or update on app.person_aspirations
for each row execute function private.touch_versioned_row();

create trigger person_aspirations_audit
after insert or update or delete on app.person_aspirations
for each row execute function private.audit_row_change();

create or replace function public.list_person_aspirations(
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
  v_items jsonb;
begin
  if p_organization_id is null or p_person_id is null then
    raise exception using errcode = '22023', message = 'organization and person are required';
  end if;
  v_role := private.evaluation_actor_role(p_organization_id, p_person_id);

  with readable as (
    select aspiration.*
    from app.person_aspirations as aspiration
    where aspiration.organization_id = p_organization_id
      and aspiration.person_id = p_person_id
    order by aspiration.heard_on desc, aspiration.created_at desc, aspiration.id
    limit 200
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', readable.id,
      'version', readable.version,
      'personId', readable.person_id,
      'heardOn', readable.heard_on,
      'authorName', coalesce(nullif(btrim(author.display_name), ''), 'MOSAICユーザー'),
      'createdAt', readable.created_at,
      'updatedAt', readable.updated_at,
      'mine', readable.created_by = v_user_id,
      'canEdit', readable.created_by = v_user_id and readable.withdrawn_at is null,
      'canWithdraw', readable.withdrawn_at is null and (readable.created_by = v_user_id or v_role in ('owner', 'admin'))
    ) || case
      when readable.withdrawn_at is null or v_role = 'owner' or readable.created_by = v_user_id then jsonb_build_object(
        'context', readable.context,
        'wishes', readable.wishes,
        'avoids', readable.avoids
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
    order by readable.heard_on desc, readable.created_at desc, readable.id
  ), '[]'::jsonb)
  into v_items
  from readable
  left join app.profiles as author on author.id = readable.created_by
  left join app.profiles as withdrawer on withdrawer.id = readable.withdrawn_by;

  return jsonb_build_object('items', v_items, 'canWrite', true);
end;
$function$;

create or replace function public.save_person_aspiration(
  p_organization_id uuid,
  p_request_id uuid,
  p_aspiration jsonb
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
  v_heard_on date;
  v_context text;
  v_wishes text;
  v_avoids text;
  v_expected bigint;
  v_existing app.person_aspirations%rowtype;
  v_saved app.person_aspirations%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'organization and request id are required';
  end if;
  if p_aspiration is null or jsonb_typeof(p_aspiration) <> 'object'
     or (p_aspiration - array['id', 'expectedVersion', 'personId', 'heardOn', 'context', 'wishes', 'avoids']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'p_aspiration takes only id, expectedVersion, personId, heardOn, context, wishes, and avoids';
  end if;

  if not coalesce(p_aspiration ->> 'personId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  v_person_id := (p_aspiration ->> 'personId')::uuid;
  perform private.evaluation_actor_role(p_organization_id, v_person_id);

  v_context := nullif(btrim(coalesce(p_aspiration ->> 'context', '')), '');
  v_wishes := nullif(btrim(coalesce(p_aspiration ->> 'wishes', '')), '');
  v_avoids := nullif(btrim(coalesce(p_aspiration ->> 'avoids', '')), '');
  if v_wishes is null and v_avoids is null then
    raise exception using errcode = '22023', message = 'an aspiration needs wishes or avoids';
  end if;
  if char_length(coalesce(v_wishes, '')) > 1000 or char_length(coalesce(v_avoids, '')) > 1000 then
    raise exception using errcode = '22023', message = 'each aspiration text is at most 1000 characters';
  end if;
  if char_length(coalesce(v_context, '')) > 200 then
    raise exception using errcode = '22023', message = 'context is at most 200 characters';
  end if;
  if coalesce(p_aspiration ->> 'heardOn', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = '22023', message = 'heardOn must be a date';
  end if;
  v_heard_on := (p_aspiration ->> 'heardOn')::date;

  perform set_config('app.request_id', p_request_id::text, true);

  if nullif(p_aspiration ->> 'id', '') is null then
    -- The unique request id is the reservation: a concurrent retry loses the
    -- insert here and reads the row the other one wrote.
    insert into app.person_aspirations (
      organization_id, request_id, person_id, heard_on,
      context, wishes, avoids, created_by, updated_by
    ) values (
      p_organization_id, p_request_id, v_person_id, v_heard_on,
      v_context, v_wishes, v_avoids, v_user_id, v_user_id
    )
    on conflict (organization_id, request_id) do nothing
    returning * into v_saved;
    if found then
      return jsonb_build_object('id', v_saved.id, 'version', v_saved.version, 'replayed', false);
    end if;

    select aspiration.*
    into v_existing
    from app.person_aspirations as aspiration
    where aspiration.organization_id = p_organization_id
      and aspiration.request_id = p_request_id;
    if not found or v_existing.created_by is distinct from v_user_id then
      raise exception using errcode = '42501', message = 'not authorized';
    end if;
    if v_existing.person_id <> v_person_id then
      raise exception using errcode = '22023', message = 'p_request_id was already used for another aspiration';
    end if;
    return jsonb_build_object('id', v_existing.id, 'version', v_existing.version, 'replayed', true);
  end if;

  if not (p_aspiration ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  v_id := (p_aspiration ->> 'id')::uuid;
  select aspiration.*
  into v_existing
  from app.person_aspirations as aspiration
  where aspiration.organization_id = p_organization_id
    and aspiration.id = v_id
  for update;
  if not found
     or v_existing.person_id <> v_person_id
     or v_existing.created_by is distinct from v_user_id
     or v_existing.withdrawn_at is not null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if coalesce(p_aspiration ->> 'expectedVersion', '') !~ '^\d+$' then
    raise exception using errcode = '22023', message = 'expectedVersion is required to change an aspiration';
  end if;
  v_expected := (p_aspiration ->> 'expectedVersion')::bigint;
  if v_existing.version <> v_expected then
    raise exception using errcode = '40001', message = 'aspiration was changed since it was read';
  end if;

  update app.person_aspirations as aspiration
  set
    heard_on = v_heard_on,
    context = v_context,
    wishes = v_wishes,
    avoids = v_avoids,
    updated_by = v_user_id
  where aspiration.organization_id = p_organization_id
    and aspiration.id = v_id
  returning * into v_saved;
  return jsonb_build_object('id', v_saved.id, 'version', v_saved.version, 'replayed', false);
end;
$function$;

create or replace function public.withdraw_person_aspiration(
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
  v_existing app.person_aspirations%rowtype;
  v_saved app.person_aspirations%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'organization, aspiration, and request id are required';
  end if;

  select aspiration.*
  into v_existing
  from app.person_aspirations as aspiration
  where aspiration.organization_id = p_organization_id
    and aspiration.id = p_id
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
    raise exception using errcode = '40001', message = 'aspiration was changed since it was read';
  end if;

  perform set_config('app.request_id', p_request_id::text, true);
  update app.person_aspirations as aspiration
  set
    withdrawn_at = now(),
    withdrawn_by = v_user_id,
    withdrawn_reason = v_reason,
    updated_by = v_user_id
  where aspiration.organization_id = p_organization_id
    and aspiration.id = p_id
  returning * into v_saved;
  return jsonb_build_object('id', v_saved.id, 'version', v_saved.version, 'replayed', false);
end;
$function$;

comment on function public.list_person_aspirations(uuid, uuid) is $comment$
Arguments: p_organization_id uuid, p_person_id uuid.
Returns: {"items":[{"id","version","personId","heardOn","authorName","createdAt","updatedAt",
"mine","canEdit","canWithdraw","context","wishes","avoids","withdrawn":null|{"at","byName","reason"}}],
"canWrite":true}.
What the person said, as heard by authorName. For owner/admin/planner about a person in their
scope who is not themselves; anyone else, including the subject and a viewer, gets 42501, the
same as for a person who does not exist. A withdrawn record lists context/wishes/avoids only for
the owner and the author. Newest heardOn first, at most 200. Not part of get_workspace, and
deliberately not wrapped for the external API, the AI chat, or MCP.
$comment$;

comment on function public.save_person_aspiration(uuid, uuid, jsonb) is $comment$
Arguments: p_organization_id uuid, p_request_id uuid, p_aspiration jsonb
{"id?","expectedVersion?","personId","heardOn","context?","wishes?","avoids?"}.
Returns: {"id","version","replayed"}.
Without id it creates (owner/admin/planner, a person in scope, not oneself); the same request id
replays for its author. With id it updates the caller's own record, before it is withdrawn, at
expectedVersion (40001 otherwise). wishes or avoids is required; each is at most 1000 characters
and context at most 200. An id the caller may not change and an id that does not exist both
raise 42501.
$comment$;

comment on function public.withdraw_person_aspiration(uuid, uuid, bigint, text, uuid) is $comment$
Arguments: p_organization_id uuid, p_id uuid, p_expected_version bigint, p_reason text (1-500), p_request_id uuid.
Returns: {"id","version","replayed"}.
The author, or an owner/admin who may read the person, withdraws with a reason. Withdrawing an
already withdrawn record replays. Nothing is deleted.
$comment$;

revoke all on function public.list_person_aspirations(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_person_aspirations(uuid, uuid) to authenticated;
revoke all on function public.save_person_aspiration(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_person_aspiration(uuid, uuid, jsonb) to authenticated;
revoke all on function public.withdraw_person_aspiration(uuid, uuid, bigint, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_person_aspiration(uuid, uuid, bigint, text, uuid) to authenticated;

-- Same as before, except the columns left out for everyone but the owner (and
-- always for an integration) are chosen per entity type in one place, and the
-- aspiration text joins the evaluation text there. An admin's personScope must
-- not be crossed by reading the audit instead.
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
  v_may_see_person_notes boolean;
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
  v_may_see_person_notes :=
    coalesce(nullif(current_setting('app.caller_kind', true), ''), 'user') <> 'integration'
    and v_role = 'owner';

  with page as (
    select
      audit.*,
      case
        when audit.entity_type = 'person_evaluations' and not v_may_see_person_notes
          then array['strengths', 'concerns', 'basis', 'withdrawn_reason']::text[]
        when audit.entity_type = 'person_aspirations' and not v_may_see_person_notes
          then array['context', 'wishes', 'avoids', 'withdrawn_reason']::text[]
        when not v_may_see_cost
          then array['monthly_cost_yen']::text[]
        else '{}'::text[]
      end as omitted_keys
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
        'oldData', page.old_data - page.omitted_keys,
        'newData', page.new_data - page.omitted_keys,
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
For person_evaluations, strengths/concerns/basis/withdrawn_reason, and for person_aspirations,
context/wishes/avoids/withdrawn_reason, are omitted unless the caller is the owner; integration
callers never receive them.
$comment$;

commit;
