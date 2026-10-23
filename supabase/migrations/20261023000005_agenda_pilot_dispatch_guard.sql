-- Private-company cutover gate for the *future* pilot Docker worker.
-- Deployed safely now; no company satisfies it while approvals and handover are pending.
grant usage on schema agenda_private to service_role;

create or replace function public.agenda_whatsapp_pilot_dispatch_allowed(
  p_business_id uuid,
  p_lease_id text
)
returns boolean
language sql
stable
security invoker
set search_path = public, agenda_private, pg_temp
as $fn$
  select exists (
    select 1
    from agenda_private.whatsapp_migration_reviews m
    join public.agenda_businesses b on b.id=m.business_id
    join public.agenda_whatsapp_runtime_routes r on r.business_id=b.id
    join public.agenda_baileys_sessions s on s.business_id=b.id
    where b.id=p_business_id
      and m.stage='complete'
      and m.owner_approved_at is not null
      and m.migration_completed_at is not null
      and b.status in ('active','trialing')
      and b.manual_blocked=false
      and r.runtime_prefix='local-poll:'
      and r.service_url='supabase-poll://local'
      and s.desired_online=true
      and s.status='connected'
      and s.runtime_lease_id=p_lease_id
      and s.runtime_lease_id like 'local-poll:%'
      and s.runtime_lease_expires_at>now()
      and not exists(
        select 1 from public.agenda_whatsapp_queue q
        where q.business_id=b.id
          and q.status in ('pending','processing')
          and q.scheduled_for<now()-interval '30 minutes'
      )
  )
  and (
    select count(*) from agenda_private.whatsapp_migration_reviews x
    where x.stage='complete' and x.migration_completed_at is not null
  )=1;
$fn$;
revoke all on function public.agenda_whatsapp_pilot_dispatch_allowed(uuid,text)
from public, anon, authenticated;
grant execute on function public.agenda_whatsapp_pilot_dispatch_allowed(uuid,text) to service_role;
