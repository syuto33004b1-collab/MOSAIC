begin;

-- Remote MCP confirmation stage (#334). The inbound MCP adapter confirms in
-- the host, then service_role calls this wrapper. It binds the issuer via
-- become_integration_actor and reuses submit_feedback. No new scope, no
-- service_role grant on the human RPC, no source_screen from the host.

create or replace function public.integration_submit_feedback(
  p_client_id uuid,
  p_request_id uuid,
  p_body text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_client app.integration_clients%rowtype;
begin
  if p_client_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'client and request id are required';
  end if;
  v_client := private.become_integration_actor(p_client_id);
  if not ('workspace:read' = any (v_client.scopes)) then
    raise exception using errcode = '42501', message = 'workspace:read is required';
  end if;
  return public.submit_feedback(
    v_client.organization_id,
    p_request_id,
    p_body,
    'mcp'
  );
end;
$function$;

comment on function public.integration_submit_feedback(uuid, uuid, text) is $comment$
Arguments: p_client_id uuid, p_request_id uuid, p_body text.
Returns: {"id","requestId","replayed"} from submit_feedback.
Service-role only. Organization is taken from the client, not the caller.
source_screen is the constant mcp and is stored as unknown until that label
is added to the check. Issuer permissions apply through become_integration_actor.
$comment$;

revoke all on function public.integration_submit_feedback(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.integration_submit_feedback(uuid, uuid, text)
  to service_role;

commit;
