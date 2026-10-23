-- Owner-consent preparation. No WhatsApp route/session/queue changes.
alter table agenda_private.whatsapp_migration_reviews
  add column if not exists consent_requested_at timestamptz,
  add column if not exists consent_confirmed_by uuid references auth.users(id);

-- The platform administrator has reported asking the three companies for consent.
-- This records a request, not a grant by the company owner.
update agenda_private.whatsapp_migration_reviews
set consent_requested_at=coalesce(consent_requested_at,now()),
    notes=concat_ws(' | ',notes,'Platform owner reports authorization requested; awaiting signed-in business owner confirmation.')
where consent_requested_at is null
  and business_id in (select id from public.agenda_businesses where status in ('active','trialing') and manual_blocked=false);

create or replace function public.agenda_whatsapp_owner_approve_migration(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,agenda_private,auth,pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_authorized boolean;
  v_id uuid;
  v_current_route text;
  v_active_railway boolean;
  v_stage text;
begin
  if v_user is null then raise exception 'Faça login na Agenda Pro para autorizar'; end if;
  select exists (
    select 1 from public.agenda_members m
    join public.agenda_businesses b on b.id=m.business_id
    where m.user_id=v_user and m.business_id=p_business_id
      and m.role in ('owner','admin')
      and b.manual_blocked=false and b.status in ('active','trialing')
  ) into v_authorized;
  if not v_authorized then raise exception 'Somente o responsável autorizado pode aprovar a migração da empresa'; end if;
  select coalesce(r.runtime_prefix,'default_railway'),
         coalesce(s.runtime_lease_id like 'railway:%'
            and s.runtime_lease_expires_at>now(),false)
  into v_current_route,v_active_railway
  from public.agenda_businesses b
  left join public.agenda_whatsapp_runtime_routes r on r.business_id=b.id
  left join public.agenda_baileys_sessions s on s.business_id=b.id
  where b.id=p_business_id;
  if not found then raise exception 'Empresa não localizada'; end if;
  if v_current_route='local-poll:' then
    raise exception 'Empresa já utiliza o canal Docker; procure suporte';
  end if;
  update agenda_private.whatsapp_migration_reviews
  set owner_approved_at=coalesce(owner_approved_at,now()),
      consent_confirmed_by=coalesce(consent_confirmed_by,v_user),
      stage=case when v_active_railway then 'blocked' else 'ready_for_manual_cutover' end,
      assessed_at=now()
  where business_id=p_business_id and migration_completed_at is null
  returning business_id,stage into v_id,v_stage;
  if v_id is null then raise exception 'Migração não solicitada ou já concluída'; end if;
  return jsonb_build_object(
    'ok',true,
    'business_id',v_id,
    'consent_registered',true,
    'stage',v_stage,
    'whatsapp_was_disconnected',false,
    'route_changed',false,
    'next_step','A equipe da Agenda Pro coordenará o pareamento e a transferência em horário seguro.'
  );
end;
$$;
revoke all on function public.agenda_whatsapp_owner_approve_migration(uuid) from public,anon,authenticated;
grant execute on function public.agenda_whatsapp_owner_approve_migration(uuid) to authenticated;

create or replace function public.agenda_whatsapp_my_migration_status(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,agenda_private,auth,pg_temp
as $$
declare v_user uuid:=auth.uid(); v_data jsonb;
begin
  if v_user is null or not exists (
    select 1 from public.agenda_members m where m.business_id=p_business_id
      and m.user_id=v_user and m.role in ('owner','admin')
  ) then
    raise exception 'Acesso não autorizado';
  end if;
  select jsonb_build_object(
    'business_id',m.business_id,'stage',m.stage,
    'consent_requested',m.consent_requested_at is not null,
    'consent_confirmed',m.owner_approved_at is not null,
    'consent_confirmed_at',m.owner_approved_at,
    'requires_new_pairing',true,
    'cutover_complete',m.migration_completed_at is not null
  ) into v_data
  from agenda_private.whatsapp_migration_reviews m where m.business_id=p_business_id;
  return coalesce(v_data,jsonb_build_object('stage','not_requested'));
end;
$$;
revoke all on function public.agenda_whatsapp_my_migration_status(uuid) from public,anon,authenticated;
grant execute on function public.agenda_whatsapp_my_migration_status(uuid) to authenticated;
