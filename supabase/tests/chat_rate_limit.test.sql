begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(17);

-- 502a/502b are members of the first organization, 502a also of the second.
-- 502c is outside both, 502d is suspended, 502e has a full window from the
-- previous minute.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000521', 'chat-a@test.local', '{"full_name":"Chat A"}'::jsonb),
  ('11000000-0000-4000-8000-000000000522', 'chat-b@test.local', '{"full_name":"Chat B"}'::jsonb),
  ('11000000-0000-4000-8000-000000000523', 'chat-outsider@test.local', '{"full_name":"Chat Outsider"}'::jsonb),
  ('11000000-0000-4000-8000-000000000524', 'chat-suspended@test.local', '{"full_name":"Chat Suspended"}'::jsonb),
  ('11000000-0000-4000-8000-000000000525', 'chat-e@test.local', '{"full_name":"Chat E"}'::jsonb);

insert into app.organizations (id, name, slug, workspace_changed_by, created_by, updated_by) values
  ('21000000-0000-4000-8000-000000000521', 'Chat Tenant One', 'chat-tenant-one-test',
   '11000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521'),
  ('21000000-0000-4000-8000-000000000522', 'Chat Tenant Two', 'chat-tenant-two-test',
   '11000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521');

insert into app.organization_memberships (organization_id, user_id, role, status, created_by, updated_by) values
  ('21000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521', 'owner', 'active',
   '11000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521'),
  ('21000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000522', 'viewer', 'active',
   '11000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521'),
  ('21000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000524', 'planner', 'suspended',
   '11000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521'),
  ('21000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000525', 'planner', 'active',
   '11000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521'),
  ('21000000-0000-4000-8000-000000000522', '11000000-0000-4000-8000-000000000521', 'owner', 'active',
   '11000000-0000-4000-8000-000000000521', '11000000-0000-4000-8000-000000000521');

-- now() is fixed for the transaction, so every call below lands in one window.
insert into app.chat_rate_windows (actor_user_id, organization_id, window_started_at, request_count) values
  ('11000000-0000-4000-8000-000000000525', '21000000-0000-4000-8000-000000000521', date_trunc('minute', now()) - interval '1 minute', 12),
  ('11000000-0000-4000-8000-000000000521', '21000000-0000-4000-8000-000000000521', date_trunc('minute', now()) - interval '2 hours', 3),
  ('11000000-0000-4000-8000-000000000522', '21000000-0000-4000-8000-000000000521', date_trunc('minute', now()) - interval '2 hours', 3);

select ok(
  not has_table_privilege('authenticated', 'app.chat_rate_windows', 'SELECT')
  and not has_table_privilege('authenticated', 'app.chat_rate_windows', 'INSERT')
  and not has_table_privilege('authenticated', 'app.chat_rate_windows', 'UPDATE')
  and not has_table_privilege('authenticated', 'app.chat_rate_windows', 'DELETE')
  and not has_table_privilege('anon', 'app.chat_rate_windows', 'SELECT')
  and not has_table_privilege('service_role', 'app.chat_rate_windows', 'SELECT'),
  'no role can read or write the windows directly'
);

select ok(
  has_function_privilege('authenticated', 'public.consume_chat_rate_limit(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.consume_chat_rate_limit(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.consume_chat_rate_limit(uuid)', 'EXECUTE'),
  'only authenticated may execute consume_chat_rate_limit'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000521';

select is(
  public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521'),
  '{"allowed": true, "remaining": 11}'::jsonb,
  'the first request of the minute is allowed with 11 left'
);

reset role;

select is(
  (select array_agg(actor_user_id order by actor_user_id) from app.chat_rate_windows
   where window_started_at < date_trunc('minute', now()) - interval '1 hour'),
  array['11000000-0000-4000-8000-000000000522'::uuid],
  'a call removes the caller''s own windows older than an hour and leaves other users'' alone'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000521';

select is(
  (select array_agg((public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521') ->> 'remaining')::integer order by n)
   from generate_series(2, 12) as n),
  array[10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  'requests 2 to 12 are allowed and count down to 0'
);

select is(
  public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521') -> 'allowed',
  'false'::jsonb,
  'the 13th request in the minute is refused'
);

select ok(
  (public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521') ->> 'retryAfterSeconds')::integer between 1 and 60,
  'a refusal says how many seconds until the next window'
);

select is(
  (public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521') ->> 'retryAt')::timestamptz,
  date_trunc('minute', now()) + interval '1 minute',
  'a refusal names the start of the next window'
);

select is(
  public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000522'),
  '{"allowed": true, "remaining": 11}'::jsonb,
  'the same user in another organization counts separately'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000522';

select is(
  public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521'),
  '{"allowed": true, "remaining": 11}'::jsonb,
  'another member of the same organization counts separately'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000525';

select is(
  public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521'),
  '{"allowed": true, "remaining": 11}'::jsonb,
  'a full window from the previous minute does not carry over'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000523';

select throws_ok(
  $$select public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521')$$,
  '42501',
  'not authorized',
  'a non-member is refused'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000524';

select throws_ok(
  $$select public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521')$$,
  '42501',
  'not authorized',
  'a suspended member is refused'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000521';

select throws_ok(
  $$select * from app.chat_rate_windows$$,
  '42501',
  null,
  'a member cannot read the windows'
);

reset role;

select is(
  (select request_count from app.chat_rate_windows
   where actor_user_id = '11000000-0000-4000-8000-000000000521'
     and organization_id = '21000000-0000-4000-8000-000000000521'
     and window_started_at = date_trunc('minute', now())),
  12,
  'refused requests are not counted'
);

select is(
  (select count(*)::integer from app.chat_rate_windows
   where actor_user_id in ('11000000-0000-4000-8000-000000000523', '11000000-0000-4000-8000-000000000524')),
  0,
  'a refused caller leaves no row'
);

set local role anon;
set local request.jwt.claim.role = 'anon';
set local request.jwt.claim.sub = '';

select throws_ok(
  $$select public.consume_chat_rate_limit('21000000-0000-4000-8000-000000000521')$$,
  '42501',
  null,
  'an anonymous caller cannot execute it'
);

select * from finish();
rollback;
