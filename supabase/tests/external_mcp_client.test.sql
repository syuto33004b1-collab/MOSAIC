begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000101', 'mcp-owner@test.local', '{"full_name":"MCP Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000102', 'mcp-planner@test.local', '{"full_name":"MCP Planner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000103', 'mcp-outsider@test.local', '{"full_name":"MCP Outsider"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000101',
  'MCP Client Tenant',
  'mcp-client-tenant-test',
  '11000000-0000-4000-8000-000000000101',
  '11000000-0000-4000-8000-000000000101',
  '11000000-0000-4000-8000-000000000101'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  ('21000000-0000-4000-8000-000000000101', '11000000-0000-4000-8000-000000000101', 'owner', 'active',
   '11000000-0000-4000-8000-000000000101', '11000000-0000-4000-8000-000000000101'),
  ('21000000-0000-4000-8000-000000000101', '11000000-0000-4000-8000-000000000102', 'planner', 'active',
   '11000000-0000-4000-8000-000000000101', '11000000-0000-4000-8000-000000000101');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000101';

select lives_ok(
  $$select public.create_mcp_server(
      '21000000-0000-4000-8000-000000000101',
      'acme_hr',
      'ACME人事',
      'https://mcp.example.com/mcp',
      array['search_employee', 'get_attendance']::text[],
      '91000000-0000-4000-8000-000000000101'
    )$$,
  'an owner may approve an external mcp server'
);

select is(
  (
    select entry.server ->> 'serverKey'
    from jsonb_array_elements(public.list_mcp_servers('21000000-0000-4000-8000-000000000101') -> 'servers') as entry(server)
    limit 1
  ),
  'acme_hr',
  'the registry lists the approved server for owners and admins'
);

select is(
  (
    select entry.server -> 'tools'
    from jsonb_array_elements(public.list_mcp_tools('21000000-0000-4000-8000-000000000101') -> 'servers') as entry(server)
    where entry.server ->> 'serverKey' = 'acme_hr'
  ),
  '["get_attendance", "search_employee"]'::jsonb,
  'list_mcp_tools exposes the approved tool names'
);

select ok(
  not (
    (
      select entry.server
      from jsonb_array_elements(public.list_mcp_tools('21000000-0000-4000-8000-000000000101') -> 'servers') as entry(server)
      where entry.server ->> 'serverKey' = 'acme_hr'
    ) ? 'url'
  ),
  'list_mcp_tools never returns the server address'
);

select throws_ok(
  $$select public.create_mcp_server(
      '21000000-0000-4000-8000-000000000101',
      'internal_x',
      '内部',
      'https://127.0.0.1/mcp',
      array['ping']::text[],
      '91000000-0000-4000-8000-000000000102'
    )$$,
  '22023',
  'mcp server url must not target a private or loopback host',
  'a loopback address cannot be approved'
);

select throws_ok(
  $$select public.create_mcp_server(
      '21000000-0000-4000-8000-000000000101',
      'plain_http',
      '平文',
      'http://mcp.example.com/mcp',
      array['ping']::text[],
      '91000000-0000-4000-8000-000000000103'
    )$$,
  '22023',
  'mcp server url must be an https address',
  'a non-https address cannot be approved'
);

select throws_ok(
  $$select public.create_mcp_server(
      '21000000-0000-4000-8000-000000000101',
      'creds',
      '資格入り',
      'https://user:pass@mcp.example.com/mcp',
      array['ping']::text[],
      '91000000-0000-4000-8000-000000000104'
    )$$,
  '22023',
  'mcp server url must not embed credentials',
  'a url embedding credentials cannot be approved'
);

select throws_ok(
  $$select public.create_mcp_server(
      '21000000-0000-4000-8000-000000000101',
      'too_many',
      '多すぎ',
      'https://mcp.example.com/mcp',
      array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']::text[],
      '91000000-0000-4000-8000-000000000105'
    )$$,
  '22023',
  'at most 8 tools may be approved per mcp server',
  'at most 8 tools may be approved'
);

select throws_ok(
  $$select public.create_mcp_server(
      '21000000-0000-4000-8000-000000000101',
      'ipv6_lit',
      'IPv6',
      'https://[::1]/mcp',
      array['ping']::text[],
      '91000000-0000-4000-8000-000000000106'
    )$$,
  '22023',
  'mcp server url must use a hostname, not an IP literal',
  'an IPv6 literal cannot be approved'
);

select lives_ok(
  $$select public.create_mcp_server(
      '21000000-0000-4000-8000-000000000101',
      'lookalike',
      '紛らわしいホスト名',
      'https://fe8-api.example.com/mcp',
      array['ping']::text[],
      '91000000-0000-4000-8000-000000000107'
    )$$,
  'a hostname that merely looks like a private range is still approved'
);

select is(
  (
    public.begin_mcp_call('21000000-0000-4000-8000-000000000101', 'acme_hr', 'search_employee') ->> 'url'
  ),
  'https://mcp.example.com/mcp',
  'begin_mcp_call resolves the approved address for the caller'
);

select throws_ok(
  $$select public.begin_mcp_call('21000000-0000-4000-8000-000000000101', 'acme_hr', 'delete_employee')$$,
  '42501',
  'this tool is not approved for the mcp server',
  'a tool the administrator did not approve is refused'
);

select throws_ok(
  $$select public.begin_mcp_call('21000000-0000-4000-8000-000000000101', 'not_registered', 'search_employee')$$,
  'P0002',
  'mcp server not found',
  'an unregistered server key is refused'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000102';

select throws_ok(
  $$select public.list_mcp_servers('21000000-0000-4000-8000-000000000101')$$,
  '42501',
  'not authorized',
  'a planner cannot read the registry'
);

select lives_ok(
  $$select public.begin_mcp_call('21000000-0000-4000-8000-000000000101', 'acme_hr', 'get_attendance')$$,
  'a planner may call an approved tool'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000103';

select throws_ok(
  $$select public.list_mcp_tools('21000000-0000-4000-8000-000000000101')$$,
  '42501',
  'not authorized',
  'a non-member cannot see the approved tools'
);

select * from finish();
rollback;
