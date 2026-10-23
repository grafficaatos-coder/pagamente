-- Agenda Pro Julli pilot automatic confirmation and 24h reminder. Isolated, no backfill.
-- New jobs only, no stale or already attempted sends, explicit matching Docker lease.
create table if not exists agenda_private.whatsapp_dispatch_pilot (
  business_id uuid primary key references public.agenda_businesses(id) on delete cascade,
  enabled boolean not null default false,
  activated_at timestamptz,
  last_changed_at timestamptz not null default now(),
  notes text,
  constraint pilot_enabled_requires_timestamp check (not enabled or activated_at is not null)
);
revoke all on agenda_private.whatsapp_dispatch_pilot from public,anon,authenticated;
grant select on agenda_private.whatsapp_dispatch_pilot to service_role;

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
  -- Temporary single-company rollout. No bulk dispatch or accidental cross-tenant queue processing.
  if p_business_id <> '7f00c45b-b228-4ee8-b795-aadbdcfb9d45'::uuid
    or not exists(
      select 1
      from agenda_private.whatsapp_dispatch_pilot p
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

  -- No recovery replay: do not put ambiguous earlier jobs back into the queue.
  with candidate as (
    select q.id
    from public.agenda_whatsapp_queue q
    join public.agenda_appointments a on a.id=q.appointment_id and a.business_id=q.business_id
    join agenda_private.whatsapp_dispatch_pilot pilot on pilot.business_id=q.business_id
    where q.business_id=p_business_id
      and q.status='pending'
      and q.message_type in ('confirmation','reminder')
      and q.created_at>=pilot.activated_at
      and q.scheduled_for<=now()
      and q.scheduled_for>=now()-interval '10 minutes'
      and q.attempts=0
      and q.dispatch_started_at is null
      and a.starts_at>now()
      and a.status not in ('cancelled','no_show','completed')
      and q.attempts<q.max_attempts
    order by q.scheduled_for asc,q.created_at asc
    for update of q skip locked
    limit 1
  ), claimed as (
    update public.agenda_whatsapp_queue q
      set status='processing',reservation_token=gen_random_uuid(),reserved_at=now(),
          dispatch_started_at=null,attempts=attempts+1,last_error=null,updated_at=now()
    from candidate c
    where q.id=c.id
    returning q.*
  )
  select to_jsonb(claimed.*) into v_job from claimed;
  return v_job;
end;
$fn$;
revoke all on function public.agenda_baileys_claim_next_pilot(uuid,text) from public,anon,authenticated;
grant execute on function public.agenda_baileys_claim_next_pilot(uuid,text) to service_role;

insert into agenda_private.whatsapp_dispatch_pilot(business_id,enabled,notes)
values('7f00c45b-b228-4ee8-b795-aadbdcfb9d45'::uuid,false,
       'Julli only; allow new bookings and 24h reminders after activation, never backfill old queue.')
on conflict(business_id) do nothing;
