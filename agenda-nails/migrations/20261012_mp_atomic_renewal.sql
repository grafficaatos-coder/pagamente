-- REVIEW REQUIRED before running. This does not charge or create subscriptions.
-- Runtime webhook feature flag AGENDA_MP_RENEWAL_ENABLED stays OFF until tested.
create or replace function public.agenda_mp_apply_verified_invoice(
 p_business_id uuid, p_preapproval_id text, p_invoice_id text,
 p_amount_cents bigint, p_currency text, p_provider_status text, p_paid_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_subscription record; v_price bigint; v_id bigint; v_end timestamptz;
begin
 if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
   raise exception 'service_role_required' using errcode='42501';
 end if;
 if p_business_id is null or coalesce(length(p_preapproval_id),0) not between 1 and 120
    or coalesce(length(p_invoice_id),0) not between 1 and 120 then
   raise exception 'invalid_identifiers';
 end if;
 if p_currency <> 'BRL' or p_provider_status <> 'approved'
    or p_amount_cents is null or p_amount_cents <= 0
    or p_paid_at is null or p_paid_at > now()+interval '10 minutes' then
   raise exception 'unverified_invoice';
 end if;
 select s.plan_id,s.mp_preapproval_id,s.current_period_end into v_subscription
 from public.agenda_subscriptions s where s.business_id=p_business_id for update;
 if not found or v_subscription.mp_preapproval_id is distinct from p_preapproval_id then
   raise exception 'wrong_subscription';
 end if;
 select monthly_price_cents into v_price from public.agenda_plans
 where id=v_subscription.plan_id;
 if v_price is null or v_price <= 0 or v_price <> p_amount_cents then
   raise exception 'wrong_plan_amount';
 end if;
 insert into public.agenda_mp_verified_invoices
 (authorized_payment_id,preapproval_id,business_id,amount_cents,currency,payment_status)
 values(p_invoice_id,p_preapproval_id,p_business_id,p_amount_cents,'BRL','approved')
 on conflict (authorized_payment_id) do nothing returning id into v_id;
 if v_id is null then
   return jsonb_build_object('applied',false,'reason','duplicate');
 end if;
 v_end := greatest(coalesce(v_subscription.current_period_end,p_paid_at),p_paid_at) + interval '1 month';
 update public.agenda_subscriptions set status='active',current_period_end=v_end,
 mp_status='authorized',mp_last_payment_id=p_invoice_id,
 mp_last_payment_status='approved',mp_last_payment_at=p_paid_at,
 updated_at=now() where business_id=p_business_id;
 return jsonb_build_object('applied',true,'current_period_end',v_end);
end $fn$;
revoke all on function public.agenda_mp_apply_verified_invoice(uuid,text,text,bigint,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.agenda_mp_apply_verified_invoice(uuid,text,text,bigint,text,text,timestamptz) to service_role;
