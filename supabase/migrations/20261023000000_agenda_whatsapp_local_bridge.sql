-- Canal de saída do Docker: o navegador nunca recebe chaves de serviço.
-- Inicialmente inativo: nenhum tenant é roteado automaticamente para este canal.
create table if not exists public.agenda_whatsapp_local_commands (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.agenda_businesses(id) on delete cascade,
  action text not null check (action in ('connect','disconnect','pair-code')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  result jsonb,
  http_status integer,
  claim_token uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  completed_at timestamptz,
  constraint agenda_local_payload_limit check (octet_length(payload::text)<=4096)
);
create index if not exists agenda_local_commands_pending_idx
  on public.agenda_whatsapp_local_commands (business_id,created_at)
  where status='pending';

create table if not exists public.agenda_whatsapp_local_status (
  business_id uuid primary key references public.agenda_businesses(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint agenda_local_status_limit check (octet_length(snapshot::text)<=30000)
);

alter table public.agenda_whatsapp_local_commands enable row level security;
alter table public.agenda_whatsapp_local_status enable row level security;
revoke all on public.agenda_whatsapp_local_commands from public,anon,authenticated;
revoke all on public.agenda_whatsapp_local_status from public,anon,authenticated;
grant select,insert,update on public.agenda_whatsapp_local_commands to service_role;
grant select,insert,update on public.agenda_whatsapp_local_status to service_role;

-- Atomic claim: prevents processing a request twice; abandoned requests are NOT retried.
create or replace function public.agenda_local_claim_next(p_business_id uuid)
returns public.agenda_whatsapp_local_commands
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.agenda_whatsapp_local_commands;
begin
  with picked as (
    select id from public.agenda_whatsapp_local_commands
    where business_id=p_business_id and status='pending' and expires_at>now()
    order by created_at,id
    limit 1
    for update skip locked
  )
  update public.agenda_whatsapp_local_commands as c
  set status='running',claim_token=gen_random_uuid(),claimed_at=now()
  where c.id=(select id from picked)
  returning c.* into v_job;
  return v_job;
end $$;
revoke all on function public.agenda_local_claim_next(uuid) from public,anon,authenticated;
grant execute on function public.agenda_local_claim_next(uuid) to service_role;

-- Reject late/duplicate completions using the private one-time claim token.
create or replace function public.agenda_local_finish(
  p_id uuid,p_claim_token uuid,p_status text,p_result jsonb,p_http_status integer
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_status not in ('completed','failed') or p_http_status not between 200 and 599 then
    raise exception 'Invalid completion';
  end if;
  update public.agenda_whatsapp_local_commands
  set status=p_status,result=p_result,http_status=p_http_status,completed_at=now()
  where id=p_id and status='running' and claim_token=p_claim_token
  returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.agenda_local_finish(uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.agenda_local_finish(uuid,uuid,text,jsonb,integer) to service_role;
