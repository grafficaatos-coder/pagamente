-- Controlled appointment-change notifications (Julli only).
-- Distinguish cancellation from rebooking. An actual rebooking can revive a
-- previously cancelled booking WITHOUT sending cancellation again.
-- A second genuine change may reuse a previously completed message slot;
-- processing/uncertain deliveries must never be reset or retried.
create or replace function agenda_private.queue_julli_appointment_changes()
returns trigger language plpgsql security definer
set search_path = public, agenda_private, pg_temp
as $fn$
declare
  v_kind text;
  v_name text;
  v_phone text;
  v_service text;
  v_business text;
  v_text text;
begin
  if tg_op <> 'UPDATE'
    or new.business_id <> '7f00c45b-b228-4ee8-b795-aadbdcfb9d45'::uuid
    or not exists (
      select 1 from agenda_private.whatsapp_dispatch_pilot p
      where p.business_id=new.business_id and p.enabled and p.activated_at is not null
    ) then
    return new;
  end if;

  if new.status='cancelled' and old.status is distinct from 'cancelled' then
    v_kind := 'cancellation';
  elsif new.starts_at is distinct from old.starts_at
      and new.status in ('pending','confirmed')
      and old.status not in ('completed','no_show') then
    -- Handles a live booking AND a previously cancelled booking being rebooked.
    v_kind := 'rescheduled';
  else
    return new;
  end if;
  if new.starts_at<=now() then return new; end if;

  select c.name,c.phone into v_name,v_phone
  from public.agenda_customers c
  where c.id=new.customer_id and c.business_id=new.business_id;
  if nullif(btrim(coalesce(v_phone,'')),'') is null then return new; end if;
  select s.name into v_service from public.agenda_services s
  where s.id=new.service_id and s.business_id=new.business_id;
  select regexp_replace(b.name,'^by[[:space:]]+','','i')
    into v_business from public.agenda_businesses b where b.id=new.business_id;

  if v_kind='cancellation' then
    v_text:=format(
      'Olá, %s! Seu horário com *%s* para *%s* foi cancelado. Se precisar de outro horário, entre em contato conosco.',
      split_part(btrim(coalesce(v_name,'Cliente')),' ',1),coalesce(v_business,'Agenda Pro'),
      to_char(new.starts_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
    );
  else
    v_text:=format(
      'Olá, %s! Seu horário com *%s* foi reagendado.%s%sHorário anterior: *%s*%sNovo horário: *%s*%sServiço: *%s*.%s%sTe esperamos!',
      split_part(btrim(coalesce(v_name,'Cliente')),' ',1),coalesce(v_business,'Agenda Pro'),
      chr(10),chr(10),
      to_char(old.starts_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'),
      chr(10),
      to_char(new.starts_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'),
      chr(10),coalesce(v_service,'Atendimento'),chr(10),chr(10)
    );
  end if;

  insert into public.agenda_whatsapp_queue(
    business_id,appointment_id,customer_id,message_type,scheduled_for,status,
    customer_name,customer_phone,service_name,professional_name,starts_at,
    notification_text,delivery_semantics,updated_at
  ) values (
    new.business_id,new.id,new.customer_id,v_kind,now(),'pending',
    v_name,v_phone,v_service,new.professional_name,new.starts_at,
    v_text,'AT_MOST_ONCE',now()
  )
  on conflict(appointment_id,message_type) do update set
    customer_id=excluded.customer_id,
    customer_name=excluded.customer_name,
    customer_phone=excluded.customer_phone,
    service_name=excluded.service_name,
    professional_name=excluded.professional_name,
    starts_at=excluded.starts_at,
    notification_text=excluded.notification_text,
    scheduled_for=excluded.scheduled_for,
    status='pending',
    attempts=0,
    last_error=null,
    created_at=now(),
    updated_at=now(),
    reservation_token=null,
    reserved_at=null,
    dispatch_started_at=null,
    done_at=null,
    opened_at=null,
    message_ref=null,
    idempotency_key=null
  where (
    (public.agenda_whatsapp_queue.status in ('pending','cancelled')
      and public.agenda_whatsapp_queue.attempts=0
      and public.agenda_whatsapp_queue.dispatch_started_at is null)
    or
    -- A completed prior notice may be replaced ONLY by a NEW actual change.
    (public.agenda_whatsapp_queue.status='done'
      and (v_kind='cancellation'
        or public.agenda_whatsapp_queue.starts_at is distinct from excluded.starts_at))
  );

  return new;
end;
$fn$;
revoke all on function agenda_private.queue_julli_appointment_changes() from public,anon,authenticated;
