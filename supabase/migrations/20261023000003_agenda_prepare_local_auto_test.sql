-- Runs ONLY for the isolated technical WhatsApp tenant, once.
-- Reuses the recipient who explicitly received the previous manual test.
-- No phone number or credential is embedded in this migration.
create or replace function public.agenda_prepare_local_auto_test()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company constant uuid := '270de0ad-2013-4afb-b8ba-2e21175b3f01';
  v_marker constant text := 'AGENDA_PRO_DOCKER_AUTO_TEST_2026_10_23';
  v_phone text;
  v_session_ok boolean;
  v_business_ok boolean;
  v_id uuid;
  v_customer uuid;
  v_service uuid;
  v_start timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(v_marker));

  select exists (
    select 1 from public.agenda_businesses b
    join public.agenda_whatsapp_runtime_routes r on r.business_id=b.id
    where b.id=v_company and b.manual_blocked and b.status='suspended'
    and r.runtime_prefix='local-poll:' and r.service_url='supabase-poll://local'
  ) into v_business_ok;
  if not v_business_ok then raise exception 'Technical tenant isolation check failed'; end if;

  select exists (
    select 1 from public.agenda_baileys_sessions s
    join public.agenda_whatsapp_local_status t on t.business_id=s.business_id
    where s.business_id=v_company and s.status='connected' and s.desired_online
    and s.runtime_lease_id like 'local-poll:%'
    and s.runtime_lease_expires_at>now()
    and t.updated_at>now()-interval '30 seconds'
    and t.snapshot->>'status'='connected'
  ) into v_session_ok;
  if not v_session_ok then raise exception 'Local WhatsApp test session is not currently online'; end if;

  select c.payload->>'phone' into v_phone
  from public.agenda_whatsapp_local_commands c
  where c.business_id=v_company and c.action='send-test'
    and c.status='completed' and c.http_status=200
    and c.result->>'status'='submitted'
  order by c.created_at desc
  limit 1;
  v_phone:=regexp_replace(coalesce(v_phone,''),'[^0-9]','','g');
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if v_phone !~ '^55[0-9]{10,11}$' then
    raise exception 'No previously approved test recipient found';
  end if;

  select a.id into v_id from public.agenda_appointments a
  where a.business_id=v_company and a.notes=v_marker
  order by a.created_at limit 1;
  if v_id is not null then
    return jsonb_build_object('created',false,'appointment_id',v_id,'message','existing test booking preserved');
  end if;

  if exists (select 1 from public.agenda_appointments where business_id=v_company) then
    raise exception 'Unexpected existing appointment in isolated test tenant';
  end if;

  insert into public.agenda_customers (business_id,name,phone,notes)
  values (v_company,'Cliente Técnico WhatsApp',v_phone,v_marker)
  returning id into v_customer;
  insert into public.agenda_services (business_id,name,duration_minutes,price_cents,show_price_to_client)
  values (v_company,'Teste automático de confirmação',30,0,false)
  returning id into v_service;
  -- Confirmation goes into the queue immediately; the reminder is due ~4m later.
  -- The actual appointment remains 24h+4m in the future.
  v_start:=now()+interval '24 hours 4 minutes';
  insert into public.agenda_appointments
    (business_id,customer_id,service_id,professional_name,starts_at,status,notes)
  values (v_company,v_customer,v_service,'Equipe de Testes',v_start,'confirmed',v_marker)
  returning id into v_id;

  if (select count(*) from public.agenda_whatsapp_queue
      where appointment_id=v_id and message_type in ('confirmation','reminder'))<>2 then
    raise exception 'Expected confirmation and reminder jobs were not created';
  end if;
  return jsonb_build_object(
    'created',true,'appointment_id',v_id,
    'confirmation','queued',
    'reminder','scheduled approximately 4 minutes after creation'
  );
end;
$$;
revoke all on function public.agenda_prepare_local_auto_test() from public, anon, authenticated;
grant execute on function public.agenda_prepare_local_auto_test() to service_role;
