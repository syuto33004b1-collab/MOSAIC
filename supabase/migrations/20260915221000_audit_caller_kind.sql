begin;

-- #334 needs the audit row to say the write came from an integration
-- credential. 20260915160000 rewrote audit_row_change for candidate keys and
-- dropped caller_kind / integration_client_id from the insert. The columns and
-- list_audit_events still exist; the trigger just stopped filling them.

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_organization_id uuid;
  v_entity_id uuid;
  v_entity_key jsonb;
  v_revision bigint;
  v_request_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_caller_kind text;
  v_integration_client_id uuid;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  if tg_table_name = 'organizations' then
    v_organization_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  else
    v_organization_id := coalesce(
      (v_new ->> 'organization_id')::uuid,
      (v_old ->> 'organization_id')::uuid
    );
  end if;

  if tg_table_name = 'assignment_weekend_days' then
    v_entity_id := coalesce((v_new ->> 'assignment_id')::uuid, (v_old ->> 'assignment_id')::uuid);
    v_entity_key := jsonb_build_object(
      'assignmentId', coalesce(v_new ->> 'assignment_id', v_old ->> 'assignment_id'),
      'workDate', coalesce(v_new ->> 'work_date', v_old ->> 'work_date')
    );
  elsif tg_table_name = 'person_skills' then
    v_entity_id := coalesce((v_new ->> 'person_id')::uuid, (v_old ->> 'person_id')::uuid);
    v_entity_key := jsonb_build_object(
      'personId', coalesce(v_new ->> 'person_id', v_old ->> 'person_id'),
      'skillId', coalesce(v_new ->> 'skill_id', v_old ->> 'skill_id')
    );
  elsif tg_table_name = 'staffing_need_skills' then
    v_entity_id := coalesce((v_new ->> 'staffing_need_id')::uuid, (v_old ->> 'staffing_need_id')::uuid);
    v_entity_key := jsonb_build_object(
      'staffingNeedId', coalesce(v_new ->> 'staffing_need_id', v_old ->> 'staffing_need_id'),
      'skillId', coalesce(v_new ->> 'skill_id', v_old ->> 'skill_id')
    );
  elsif tg_table_name = 'staffing_need_candidates' then
    v_entity_id := coalesce((v_new ->> 'staffing_need_id')::uuid, (v_old ->> 'staffing_need_id')::uuid);
    v_entity_key := jsonb_build_object(
      'staffingNeedId', coalesce(v_new ->> 'staffing_need_id', v_old ->> 'staffing_need_id'),
      'personId', coalesce(v_new ->> 'person_id', v_old ->> 'person_id')
    );
  else
    v_entity_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
    v_entity_key := jsonb_build_object('id', v_entity_id);
  end if;
  v_request_id := nullif(current_setting('app.request_id', true), '')::uuid;
  v_caller_kind := coalesce(nullif(current_setting('app.caller_kind', true), ''), 'user');
  if v_caller_kind not in ('user', 'ai', 'integration') then
    v_caller_kind := 'user';
  end if;
  v_integration_client_id := nullif(current_setting('app.integration_client_id', true), '')::uuid;

  select organization.workspace_revision
  into v_revision
  from app.organizations as organization
  where organization.id = v_organization_id;

  insert into app.audit_events (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    entity_key,
    request_id,
    workspace_revision,
    old_data,
    new_data,
    caller_kind,
    integration_client_id
  ) values (
    v_organization_id,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_entity_id,
    v_entity_key,
    v_request_id,
    coalesce(v_revision, 0),
    v_old,
    v_new,
    v_caller_kind,
    v_integration_client_id
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

commit;
