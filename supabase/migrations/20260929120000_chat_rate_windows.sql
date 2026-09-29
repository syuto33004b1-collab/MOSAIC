begin;

-- #502: the AI assistant's per-user limit lived in a Map inside the Edge Function,
-- so every isolate counted on its own and the limit stopped holding as soon as
-- requests landed on more than one. This counts in the database, the way
-- authorize_integration_request already does for integration credentials.

create table app.chat_rate_windows (
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references app.organizations (id) on delete cascade,
  window_started_at timestamptz not null,
  -- 12 is the limit in consume_chat_rate_limit. A row can never pass it, so a
  -- counting mistake fails loudly instead of letting requests through.
  request_count integer not null default 0 check (request_count between 0 and 12),
  primary key (actor_user_id, organization_id, window_started_at)
);

alter table app.chat_rate_windows enable row level security;
alter table app.chat_rate_windows force row level security;
revoke all on table app.chat_rate_windows from public, anon, authenticated, service_role;

create or replace function public.consume_chat_rate_limit(p_organization_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_limit constant integer := 12;
  v_now timestamptz := now();
  v_window_start timestamptz := date_trunc('minute', v_now);
  v_count integer;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  delete from app.chat_rate_windows as rate_window
  where rate_window.actor_user_id = v_actor_id
    and rate_window.window_started_at < v_window_start - interval '1 hour';

  insert into app.chat_rate_windows (actor_user_id, organization_id, window_started_at, request_count)
  values (v_actor_id, p_organization_id, v_window_start, 0)
  on conflict (actor_user_id, organization_id, window_started_at) do nothing;

  -- Locked, so concurrent requests from other isolates wait here instead of
  -- each reading 11 and all passing.
  select rate_window.request_count
  into v_count
  from app.chat_rate_windows as rate_window
  where rate_window.actor_user_id = v_actor_id
    and rate_window.organization_id = p_organization_id
    and rate_window.window_started_at = v_window_start
  for update;

  if v_count >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v_window_start + interval '1 minute' - v_now))))::integer,
      'retryAt', v_window_start + interval '1 minute'
    );
  end if;

  update app.chat_rate_windows as rate_window
  set request_count = rate_window.request_count + 1
  where rate_window.actor_user_id = v_actor_id
    and rate_window.organization_id = p_organization_id
    and rate_window.window_started_at = v_window_start
  returning rate_window.request_count into v_count;

  return jsonb_build_object('allowed', true, 'remaining', greatest(0, v_limit - v_count));
end;
$function$;

comment on function public.consume_chat_rate_limit(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns: {"allowed": true, "remaining"} or
{"allowed": false, "remaining": 0, "retryAfterSeconds", "retryAt"}.
Counts one AI assistant request for auth.uid() in the organization: 12 per
calendar minute per user and organization, shared by every Edge Function isolate.
Any active member may call it. The user comes from the JWT only.
$comment$;

revoke all on function public.consume_chat_rate_limit(uuid) from public, anon, authenticated, service_role;
grant execute on function public.consume_chat_rate_limit(uuid) to authenticated;

commit;
