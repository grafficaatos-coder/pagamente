-- Service-only routing for incremental migration. No customer/session data is copied.
create table public.agenda_whatsapp_runtime_routes (
  business_id uuid primary key references public.agenda_businesses(id) on delete cascade,
  service_url text not null check (service_url ~ '^https://'),
  runtime_prefix text not null check (runtime_prefix = 'railway:'),
  updated_at timestamptz not null default now()
);
alter table public.agenda_whatsapp_runtime_routes enable row level security;
revoke all on public.agenda_whatsapp_runtime_routes from public, anon, authenticated;
grant select, insert, update, delete on public.agenda_whatsapp_runtime_routes to service_role;

create or replace function public.agenda_baileys_acquire_lease(
  p_business_id uuid, p_lease_id text, p_ttl_seconds integer default 20
) returns boolean language plpgsql security invoker set search_path = public, pg_temp
as $function$
declare
  v_count integer;
  v_prefix text;
begin
  select runtime_prefix into v_prefix
    from public.agenda_whatsapp_runtime_routes where business_id=p_business_id;
  -- A provider loses renewal permission before the new one may acquire the lease.
  -- Existing expiry remains intact: never steal an unexpired lease.
  if v_prefix is not null and left(coalesce(p_lease_id,''),length(v_prefix))<>v_prefix then
    return false;
  end if;
  if v_prefix is null and left(coalesce(p_lease_id,''),8)='railway:' then
    return false;
  end if;
  insert into public.agenda_baileys_sessions(
    business_id,status,desired_online,profile_key,updated_at
  ) values (
    p_business_id,'connecting',true,'agenda-whatsapp/'||p_business_id::text||'.tar.gz',now()
  ) on conflict(business_id) do nothing;
  update public.agenda_baileys_sessions
    set runtime_lease_id=p_lease_id,
        runtime_lease_expires_at=now()+make_interval(secs=>greatest(5,least(coalesce(p_ttl_seconds,20),120))),
        desired_online=true,updated_at=now()
    where business_id=p_business_id and (
      runtime_lease_id is null or runtime_lease_expires_at is null
      or runtime_lease_expires_at<now() or runtime_lease_id=p_lease_id
    );
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$function$;
revoke all on function public.agenda_baileys_acquire_lease(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.agenda_baileys_acquire_lease(uuid,text,integer) to service_role;
