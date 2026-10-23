-- Agenda Pro: private, read-only assessment of a controlled Railway -> Docker WhatsApp cutover.
-- Does not alter live routing, message queues, WhatsApp leases, or Docker sessions.
create table if not exists agenda_private.whatsapp_migration_reviews (
  business_id uuid primary key references public.agenda_businesses(id) on delete cascade,
  stage text not null default 'assessment' check
    (stage in ('assessment','blocked','awaiting_owner_approval','ready_for_manual_cutover','complete')),
  owner_approved_at timestamptz,
  migration_completed_at timestamptz,
  assessed_at timestamptz not null default now(),
  notes text,
  constraint migration_review_approval_required check
    (stage not in ('ready_for_manual_cutover','complete') or owner_approved_at is not null)
);
revoke all on agenda_private.whatsapp_migration_reviews from public, anon, authenticated;
grant select,insert,update on agenda_private.whatsapp_migration_reviews to service_role;

create or replace function agenda_private.whatsapp_migration_assess(p_business_id uuid)
returns jsonb
language sql
security invoker
set search_path=public,agenda_private,pg_temp
as $fn$
  select jsonb_build_object(
    'business_id',b.id,
    'company_status',b.status,
    'current_route',coalesce(r.runtime_prefix,'default_railway'),
    'session_status',coalesce(s.status,'no_session'),
    'lease_owner',case
      when s.runtime_lease_id like 'railway:%' then 'railway'
      when s.runtime_lease_id like 'local-poll:%' then 'docker'
      else 'none'
    end,
    'active_railway_lease',coalesce(s.runtime_lease_id like 'railway:%'
       and s.runtime_lease_expires_at>now(),false),
    'active_local_lease',coalesce(s.runtime_lease_id like 'local-poll:%'
       and s.runtime_lease_expires_at>now(),false),
    'queue_pending',(select count(*) from public.agenda_whatsapp_queue q
      where q.business_id=b.id and q.status='pending'),
    'queue_processing',(select count(*) from public.agenda_whatsapp_queue q
      where q.business_id=b.id and q.status='processing'),
    'queue_overdue',(select count(*) from public.agenda_whatsapp_queue q
      where q.business_id=b.id and q.status='pending'
        and q.scheduled_for < now()-interval '30 minutes'),
    'awaiting_owner_approval',coalesce(m.owner_approved_at is null,true),
    'owner_approved',coalesce(m.owner_approved_at is not null,false),
    'routing_changed',coalesce(r.runtime_prefix='local-poll:',false),
    'migration_stage',coalesce(m.stage,'not_assessed'),
    'cutover_requires_session_transfer_or_new_pairing',true,
    'can_cutover_automatically',false
  )
  from public.agenda_businesses b
  left join public.agenda_whatsapp_runtime_routes r on r.business_id=b.id
  left join public.agenda_baileys_sessions s on s.business_id=b.id
  left join agenda_private.whatsapp_migration_reviews m on m.business_id=b.id
  where b.id=p_business_id;
$fn$;
revoke all on function agenda_private.whatsapp_migration_assess(uuid) from public,anon,authenticated;
grant execute on function agenda_private.whatsapp_migration_assess(uuid) to service_role;

-- Assessment only. No customer approves, no session is stopped, no route is switched.
insert into agenda_private.whatsapp_migration_reviews(business_id,stage,notes)
select b.id,
  case when coalesce(s.status,'')='connected'
         and s.runtime_lease_id like 'railway:%'
         and s.runtime_lease_expires_at>now()
       then 'blocked'
       else 'awaiting_owner_approval' end,
  case when coalesce(s.status,'')='connected'
         and s.runtime_lease_id like 'railway:%'
         and s.runtime_lease_expires_at>now()
       then 'Connected on Railway: do not auto-cutover; requires tenant owner and no overlapping session.'
       else 'Do not reroute until tenant owner approves and a re-pair or secure session transfer is coordinated.' end
from public.agenda_businesses b
join public.agenda_baileys_sessions s on s.business_id=b.id
where b.status in ('active','trialing')
  and not b.manual_blocked
  and b.id <> '270de0ad-2013-4afb-b8ba-2e21175b3f01'::uuid
on conflict(business_id) do nothing;
