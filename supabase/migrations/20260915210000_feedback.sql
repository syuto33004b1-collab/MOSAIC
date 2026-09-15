begin;

-- In-app feedback (#333). Operational, not workspace data: dedicated table and
-- RPCs so a board save cannot collide with a report, and so #334 can later wrap
-- the same rows without touching save_workspace.

create table app.feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  request_id uuid not null,
  seq bigint generated always as identity not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  source_screen text not null check (source_screen in (
    'board',
    'projects',
    'opportunities',
    'members',
    'proposal',
    'org',
    'skills',
    'fields',
    'reports',
    'unknown'
  )),
  status text not null default 'open' check (status in ('open', 'done')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  unique (organization_id, request_id),
  unique (organization_id, seq)
);

create index feedback_org_seq_idx
  on app.feedback (organization_id, seq desc);
create index feedback_rate_idx
  on app.feedback (organization_id, created_by, created_at desc);

alter table app.feedback enable row level security;
alter table app.feedback force row level security;

revoke all on table app.feedback from public, anon, authenticated, service_role;

create trigger feedback_touch
before insert or update on app.feedback
for each row execute function private.touch_versioned_row();

create trigger feedback_audit
after insert or update or delete on app.feedback
for each row execute function private.audit_row_change();

create or replace function private.normalize_feedback_screen(p_source_screen text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_source_screen in (
      'board',
      'projects',
      'opportunities',
      'members',
      'proposal',
      'org',
      'skills',
      'fields',
      'reports'
    ) then p_source_screen
    else 'unknown'
  end;
$function$;

revoke all on function private.normalize_feedback_screen(text) from public, anon, authenticated;
grant execute on function private.normalize_feedback_screen(text) to authenticated, service_role;

create or replace function public.submit_feedback(
  p_organization_id uuid,
  p_request_id uuid,
  p_body text,
  p_source_screen text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_screen text := private.normalize_feedback_screen(p_source_screen);
  v_existing app.feedback%rowtype;
  v_inserted app.feedback%rowtype;
  v_recent integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'organization and request id are required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception using errcode = '22023', message = 'feedback body must be between 1 and 2000 characters';
  end if;

  select feedback.*
  into v_existing
  from app.feedback as feedback
  where feedback.organization_id = p_organization_id
    and feedback.request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'requestId', v_existing.request_id,
      'replayed', true
    );
  end if;

  select count(*)
  into v_recent
  from app.feedback as feedback
  where feedback.organization_id = p_organization_id
    and feedback.created_by = v_user_id
    and feedback.created_at > now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception using errcode = '54000', message = 'feedback is limited to 20 submissions per hour';
  end if;

  perform set_config('app.request_id', p_request_id::text, true);

  insert into app.feedback (
    organization_id,
    request_id,
    body,
    source_screen,
    created_by,
    updated_by
  ) values (
    p_organization_id,
    p_request_id,
    v_body,
    v_screen,
    v_user_id,
    v_user_id
  )
  on conflict (organization_id, request_id) do nothing
  returning * into v_inserted;

  if not found then
    select feedback.*
    into v_existing
    from app.feedback as feedback
    where feedback.organization_id = p_organization_id
      and feedback.request_id = p_request_id;
    if not found then
      raise exception using errcode = '55000', message = 'feedback request is incomplete';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'requestId', v_existing.request_id,
      'replayed', true
    );
  end if;

  return jsonb_build_object(
    'id', v_inserted.id,
    'requestId', v_inserted.request_id,
    'replayed', false
  );
end;
$function$;

create or replace function public.list_feedback(
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
  v_user_id uuid := auth.uid();
  v_limit integer := coalesce(p_limit, 50);
  v_items jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id is required';
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_limit < 1 or v_limit > 200 then
    raise exception using errcode = '22023', message = 'p_limit must be between 1 and 200';
  end if;

  with page as (
    select feedback.*
    from app.feedback as feedback
    where feedback.organization_id = p_organization_id
      and (p_before is null or feedback.seq < p_before)
    order by feedback.seq desc
    limit v_limit
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', page.id,
      'seq', page.seq,
      'body', page.body,
      'sourceScreen', page.source_screen,
      'status', page.status,
      'createdAt', page.created_at,
      'createdByName', coalesce(nullif(btrim(profile.display_name), ''), 'MOSAICユーザー'),
      'createdByRole', membership.role
    ) order by page.seq desc
  ), '[]'::jsonb)
  into v_items
  from page
  left join app.profiles as profile on profile.id = page.created_by
  left join app.organization_memberships as membership
    on membership.organization_id = page.organization_id
   and membership.user_id = page.created_by;

  return jsonb_build_object(
    'items', v_items,
    'nextBefore', (
      select page.oldest
      from (
        select min(feedback.seq) as oldest
        from (
          select feedback.seq
          from app.feedback as feedback
          where feedback.organization_id = p_organization_id
            and (p_before is null or feedback.seq < p_before)
          order by feedback.seq desc
          limit v_limit
        ) as feedback
      ) as page
      where exists (
        select 1
        from app.feedback as older
        where older.organization_id = p_organization_id
          and older.seq < page.oldest
      )
    )
  );
end;
$function$;

create or replace function public.update_feedback_status(
  p_organization_id uuid,
  p_id uuid,
  p_status text,
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
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_existing app.feedback%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'organization, feedback, and request id are required';
  end if;
  if v_status not in ('open', 'done') then
    raise exception using errcode = '22023', message = 'feedback status must be open or done';
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  perform set_config('app.request_id', p_request_id::text, true);

  select feedback.*
  into v_existing
  from app.feedback as feedback
  where feedback.organization_id = p_organization_id
    and feedback.id = p_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'feedback not found';
  end if;

  if v_existing.status = v_status then
    return jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.status,
      'requestId', p_request_id,
      'replayed', true
    );
  end if;

  update app.feedback as feedback
  set
    status = v_status,
    updated_by = v_user_id
  where feedback.organization_id = p_organization_id
    and feedback.id = p_id;

  return jsonb_build_object(
    'id', v_existing.id,
    'status', v_status,
    'requestId', p_request_id,
    'replayed', false
  );
end;
$function$;

comment on function public.submit_feedback(uuid, uuid, text, text) is $comment$
Arguments: p_organization_id uuid, p_request_id uuid, p_body text, p_source_screen text.
Returns: {"id","requestId","replayed"}.
Any active member may submit. Unknown screens are stored as unknown rather than
rejected. The same actor/organization/request id replays the original row.
Capped at 20 submissions per caller per organization per hour.
$comment$;

comment on function public.list_feedback(uuid, integer, bigint) is $comment$
Arguments: p_organization_id uuid, p_limit integer default 50, p_before bigint.
Returns: {"items":[{"id","seq","body","sourceScreen","status","createdAt","createdByName","createdByRole"}],"nextBefore"}.
Owner/admin only. Pages on the monotonic seq, newest first. Does not return email.
$comment$;

comment on function public.update_feedback_status(uuid, uuid, text, uuid) is $comment$
Arguments: p_organization_id uuid, p_id uuid, p_status text (open|done), p_request_id uuid.
Returns: {"id","status","requestId","replayed"}.
Owner/admin only. Locates the row by organization and id together. Setting the
status the row already has is a no-op replay.
$comment$;

revoke all on function public.submit_feedback(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_feedback(uuid, uuid, text, text) to authenticated;
revoke all on function public.list_feedback(uuid, integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.list_feedback(uuid, integer, bigint) to authenticated;
revoke all on function public.update_feedback_status(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.update_feedback_status(uuid, uuid, text, uuid) to authenticated;

commit;
