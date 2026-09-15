begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000331', 'fb-owner@test.local', '{"full_name":"気づき Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000332', 'fb-admin@test.local', '{"full_name":"気づき Admin"}'::jsonb),
  ('11000000-0000-4000-8000-000000000333', 'fb-planner@test.local', '{"full_name":"気づき Planner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000334', 'fb-viewer@test.local', '{"full_name":"気づき Viewer"}'::jsonb),
  ('11000000-0000-4000-8000-000000000335', 'fb-other@test.local', '{"full_name":"気づき Other"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values
  (
    '21000000-0000-4000-8000-000000000333',
    'Feedback Tenant',
    'feedback-tenant-test',
    '11000000-0000-4000-8000-000000000331',
    '11000000-0000-4000-8000-000000000331',
    '11000000-0000-4000-8000-000000000331'
  ),
  (
    '21000000-0000-4000-8000-000000000334',
    'Feedback Other Tenant',
    'feedback-other-tenant-test',
    '11000000-0000-4000-8000-000000000335',
    '11000000-0000-4000-8000-000000000335',
    '11000000-0000-4000-8000-000000000335'
  );

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  ('21000000-0000-4000-8000-000000000333', '11000000-0000-4000-8000-000000000331', 'owner', 'active',
   '11000000-0000-4000-8000-000000000331', '11000000-0000-4000-8000-000000000331'),
  ('21000000-0000-4000-8000-000000000333', '11000000-0000-4000-8000-000000000332', 'admin', 'active',
   '11000000-0000-4000-8000-000000000331', '11000000-0000-4000-8000-000000000331'),
  ('21000000-0000-4000-8000-000000000333', '11000000-0000-4000-8000-000000000333', 'planner', 'active',
   '11000000-0000-4000-8000-000000000331', '11000000-0000-4000-8000-000000000331'),
  ('21000000-0000-4000-8000-000000000333', '11000000-0000-4000-8000-000000000334', 'viewer', 'active',
   '11000000-0000-4000-8000-000000000331', '11000000-0000-4000-8000-000000000331'),
  ('21000000-0000-4000-8000-000000000334', '11000000-0000-4000-8000-000000000335', 'owner', 'active',
   '11000000-0000-4000-8000-000000000335', '11000000-0000-4000-8000-000000000335');

select ok(
  not has_table_privilege('authenticated', 'app.feedback', 'SELECT')
  and not has_table_privilege('authenticated', 'app.feedback', 'INSERT')
  and not has_table_privilege('anon', 'app.feedback', 'SELECT'),
  'browser cannot touch app.feedback directly'
);

select ok(
  has_function_privilege('authenticated', 'public.submit_feedback(uuid,uuid,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_feedback(uuid,integer,bigint)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_feedback_status(uuid,uuid,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.submit_feedback(uuid,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.submit_feedback(uuid,uuid,text,text)', 'EXECUTE'),
  'only authenticated may execute the feedback RPCs'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000334';

select lives_ok(
  $$select public.submit_feedback(
      '21000000-0000-4000-8000-000000000333',
      '91000000-0000-4000-8000-000000000331',
      'ボードの空き列が狭い',
      'board'
    )$$,
  'viewer may submit feedback'
);

select is(
  public.submit_feedback(
    '21000000-0000-4000-8000-000000000333',
    '91000000-0000-4000-8000-000000000331',
    'ボードの空き列が狭い',
    'board'
  ) ->> 'replayed',
  'true',
  'the same request id replays instead of inserting again'
);

select is(
  public.submit_feedback(
    '21000000-0000-4000-8000-000000000333',
    '91000000-0000-4000-8000-000000000332',
    '運用パネルから送りたい',
    'operations'
  ) ->> 'id' is not null,
  true,
  'an unknown screen is accepted'
);

select is(
  (
    select feedback.source_screen
    from app.feedback as feedback
    where feedback.request_id = '91000000-0000-4000-8000-000000000332'
  ),
  'unknown',
  'operations and other unknown screens are stored as unknown'
);

select throws_ok(
  $$select public.list_feedback('21000000-0000-4000-8000-000000000333', 50, null)$$,
  '42501',
  'not authorized',
  'viewer cannot list feedback'
);

select throws_ok(
  $$select public.submit_feedback(
      '21000000-0000-4000-8000-000000000334',
      '91000000-0000-4000-8000-000000000333',
      '他組織へは送れない',
      'board'
    )$$,
  '42501',
  'not authorized',
  'viewer cannot submit into another organization'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000333';

select throws_ok(
  $$select public.list_feedback('21000000-0000-4000-8000-000000000333', 50, null)$$,
  '42501',
  'not authorized',
  'planner cannot list feedback'
);

select throws_ok(
  $$select public.update_feedback_status(
      '21000000-0000-4000-8000-000000000333',
      '00000000-0000-4000-8000-000000000001',
      'done',
      '91000000-0000-4000-8000-000000000334'
    )$$,
  '42501',
  'not authorized',
  'planner cannot change feedback status'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000331';

select ok(
  (
    select jsonb_array_length(public.list_feedback('21000000-0000-4000-8000-000000000333', 50, null) -> 'items') = 2
      and bool_and(item ->> 'createdByName' is not null)
      and bool_and(not (item ? 'email'))
      and bool_and(not (item ? 'createdByEmail'))
    from jsonb_array_elements(
      public.list_feedback('21000000-0000-4000-8000-000000000333', 50, null) -> 'items'
    ) as item
  ),
  'owner lists the org feedback without email'
);

select is(
  (
    select item ->> 'sourceScreen'
    from jsonb_array_elements(
      public.list_feedback('21000000-0000-4000-8000-000000000333', 50, null) -> 'items'
    ) as item
    where item ->> 'body' = '運用パネルから送りたい'
  ),
  'unknown',
  'owner sees the rounded unknown screen'
);

select lives_ok(
  $$select public.update_feedback_status(
      '21000000-0000-4000-8000-000000000333',
      (
        select feedback.id
        from app.feedback as feedback
        where feedback.request_id = '91000000-0000-4000-8000-000000000331'
      ),
      'done',
      '91000000-0000-4000-8000-000000000335'
    )$$,
  'owner may mark feedback done'
);

select is(
  public.update_feedback_status(
    '21000000-0000-4000-8000-000000000333',
    (
      select feedback.id
      from app.feedback as feedback
      where feedback.request_id = '91000000-0000-4000-8000-000000000331'
    ),
    'done',
    '91000000-0000-4000-8000-000000000336'
  ) ->> 'replayed',
  'true',
  'setting the status the row already has is a replay'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000335';

select lives_ok(
  $$select public.submit_feedback(
      '21000000-0000-4000-8000-000000000334',
      '91000000-0000-4000-8000-000000000337',
      '他組織の本文',
      'reports'
    )$$,
  'other owner may submit in their own organization'
);

select is(
  jsonb_array_length(public.list_feedback('21000000-0000-4000-8000-000000000334', 50, null) -> 'items'),
  1,
  'other owner sees only their organization'
);

select throws_ok(
  $$select public.update_feedback_status(
      '21000000-0000-4000-8000-000000000334',
      (
        select feedback.id
        from app.feedback as feedback
        where feedback.request_id = '91000000-0000-4000-8000-000000000331'
      ),
      'done',
      '91000000-0000-4000-8000-000000000338'
    )$$,
  'P0002',
  'feedback not found',
  'status updates require both organization and id'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000332';

select is(
  jsonb_array_length(public.list_feedback('21000000-0000-4000-8000-000000000333', 1, null) -> 'items'),
  1,
  'list_feedback honors the limit'
);

select ok(
  public.list_feedback('21000000-0000-4000-8000-000000000333', 1, null) ->> 'nextBefore' is not null,
  'list_feedback exposes a seq cursor when more rows remain'
);

select throws_ok(
  $$select public.submit_feedback(
      '21000000-0000-4000-8000-000000000333',
      '91000000-0000-4000-8000-000000000339',
      '',
      'board'
    )$$,
  '22023',
  'feedback body must be between 1 and 2000 characters',
  'empty body is rejected'
);

reset role;

insert into app.feedback (
  organization_id, request_id, body, source_screen, created_by, updated_by, created_at
)
select
  '21000000-0000-4000-8000-000000000333',
  ('91000000-0000-4000-8000-00000000' || lpad(n::text, 4, '0'))::uuid,
  'rate ' || n,
  'board',
  '11000000-0000-4000-8000-000000000334',
  '11000000-0000-4000-8000-000000000334',
  now()
from generate_series(1, 18) as n;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000334';

select throws_ok(
  $$select public.submit_feedback(
      '21000000-0000-4000-8000-000000000333',
      '91000000-0000-4000-8000-000000000399',
      '21件目',
      'board'
    )$$,
  '54000',
  'feedback is limited to 20 submissions per hour',
  'the 21st submission in an hour is refused'
);

select is(
  public.submit_feedback(
    '21000000-0000-4000-8000-000000000333',
    '91000000-0000-4000-8000-000000000331',
    'ボードの空き列が狭い',
    'board'
  ) ->> 'replayed',
  'true',
  'a replay does not consume the hourly cap'
);

select * from finish();
rollback;
