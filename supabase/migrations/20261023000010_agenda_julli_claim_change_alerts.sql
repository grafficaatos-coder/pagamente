-- Julli pilot: add newly created cancellation and rescheduling alerts.
-- Still refuses all other businesses, stale jobs, old job retries and other types.
create or replace function public.agenda_baileys_claim_next_pilot(
  p_business_id uuid,
  p_lease_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,agenda_private,pg_temp
as $fn$
declare v_job jsonb;
begin
  if p_business_id <> '7f00c45b-b228-4ee8-b795-aadbdcfb9d45'::uuid
    or not exists (
      select 1 from agenda_private.whatsapp_dispatch_pilot p
      join public.agenda_businesses b on b.id=p.business_id
      join public.agenda_whatsapp_runtime_routes r on r.business_id=p.business_id
      join public.agenda_baileys_sessions s on s.business_id=p.business_id
      where p.business_id=p_business_id
        and p.enabled and p.activated_at is not null
        and b.status='active' and b.manual_blocked=false
        and r.runtime_prefix='local-poll:' and r.service_url='supabase-poll://local'
        and s.status='connected' and s.desired_online=true
        and s.runtime_lease_id=p_lease_id
        and s.runtime_lease_id like 'local-poll:%'
        and s.runtime_lease_expires_at>now()
    ) then return null; end if;

  with candidate as (
    select q.id from public.agenda_whatsapp_queue q
    join public.agenda_appointments a on a.id=q.appointment_id and a.business_id=q.business_id
    join agenda_private.whatsapp_dispatch_pilot pilot on pilot.business_id=q.business_id
    where q.business_id=p_business_id
      and q.status='pending'
      and q.message_type in ('confirmation','reminder','cancellation','rescheduled')
      and q.created_at>=pilot.activated_at
      and q.scheduled_for<=now()
      and q.scheduled_for>=now()-interval '10 minutes'
      and q.attempts=0
      and q.dispatch_started_at is null
      and q.attempts<q.max_attempts
      and a.starts_at>now()
      and (
        (q.message_type='cancellation' and a.status='cancelled' and nullif(btrim(q.notification_text),'') is not null)
        or (q.message_type in ('confirmation','reminder','rescheduled')
          and a.status not in ('cancelled','no_show','completed')
          and (q.message_type<>'rescheduled' or nullif(btrim(q.notification_text),'') is not null))
      )
    order by q.scheduled_for asc,q.created_at asc
    for update of q skip locked
    limit 1
  ),claimed as (
    update public.agenda_whatsapp_queue q
    set status='processing',reservation_token=gen_random_uuid(),reserved_at=now(),
        dispatch_started_at=null,attempts=attempts+1,last_error=null,updated_at=now()
    from candidate c where q.id=c.id
    returning q.*
  )
  select to_jsonb(claimed.*) into v_job from claimed;
  return v_job;
end;
$fn$;
revoke all on function public.agenda_baileys_claim_next_pilot(uuid,text) from public,anon,authenticated;
grant execute on function public.agenda_baileys_claim_next_pilot(uuid,text) to service_role;
