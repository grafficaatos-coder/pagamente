-- Agenda Pro: secure Free-to-paid transition on first verified Mercado Pago payment.
-- No existing subscription or charge is modified by this migration.
ALTER TABLE public.agenda_subscriptions
  ADD COLUMN IF NOT EXISTS mp_pending_plan_id uuid REFERENCES public.agenda_plans(id);

CREATE UNIQUE INDEX IF NOT EXISTS agenda_subscriptions_mp_preapproval_unique
  ON public.agenda_subscriptions(mp_preapproval_id)
  WHERE mp_preapproval_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.agenda_mp_apply_verified_invoice(
  p_business_id uuid, p_preapproval_id text, p_invoice_id text,
  p_amount_cents bigint, p_currency text, p_provider_status text, p_paid_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $function$
DECLARE
  v_sub record;
  v_plan_id uuid;
  v_price bigint;
  v_new_id bigint;
  v_new_end timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL OR
     coalesce(length(p_preapproval_id),0) NOT BETWEEN 1 AND 120 OR
     coalesce(length(p_invoice_id),0) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_reference';
  END IF;
  IF p_currency IS DISTINCT FROM 'BRL' OR
     p_provider_status IS DISTINCT FROM 'approved' OR
     p_amount_cents IS NULL OR p_amount_cents <= 0 OR
     p_paid_at IS NULL OR
     p_paid_at > now() + INTERVAL '10 minutes' OR
     p_paid_at < now() - INTERVAL '180 days' THEN
    RAISE EXCEPTION 'invalid_payment';
  END IF;
  SELECT s.plan_id,s.mp_pending_plan_id,s.mp_preapproval_id,
         s.current_period_end,s.mp_last_payment_at,s.mp_last_payment_id,s.status
    INTO v_sub
    FROM public.agenda_subscriptions s
    WHERE s.business_id = p_business_id FOR UPDATE;
  IF NOT FOUND OR v_sub.mp_preapproval_id IS DISTINCT FROM p_preapproval_id THEN
    RAISE EXCEPTION 'subscription_mismatch';
  END IF;
  IF v_sub.status IN ('suspended','cancelled') THEN
    RAISE EXCEPTION 'subscription_blocked';
  END IF;
  v_plan_id := coalesce(v_sub.mp_pending_plan_id,v_sub.plan_id);
  SELECT monthly_price_cents INTO v_price FROM public.agenda_plans WHERE id=v_plan_id;
  IF v_price IS NULL OR v_price <= 0 OR v_price IS DISTINCT FROM p_amount_cents THEN
    RAISE EXCEPTION 'plan_amount_mismatch';
  END IF;
  INSERT INTO public.agenda_mp_verified_invoices
    (authorized_payment_id,preapproval_id,business_id,amount_cents,currency,payment_status)
    VALUES (p_invoice_id,p_preapproval_id,p_business_id,p_amount_cents,'BRL','approved')
    ON CONFLICT (authorized_payment_id) DO NOTHING RETURNING id INTO v_new_id;
  IF v_new_id IS NULL THEN
    RETURN jsonb_build_object('applied',false,'reason','duplicate');
  END IF;
  IF v_sub.mp_last_payment_at IS NOT NULL AND p_paid_at <= v_sub.mp_last_payment_at THEN
    RAISE EXCEPTION 'out_of_order_payment';
  END IF;
  IF v_sub.mp_last_payment_id IS NULL THEN
    v_new_end := p_paid_at + INTERVAL '1 month';
  ELSE
    v_new_end := greatest(coalesce(v_sub.current_period_end,p_paid_at),p_paid_at) + INTERVAL '1 month';
  END IF;
  UPDATE public.agenda_subscriptions
     SET plan_id=v_plan_id,
         mp_pending_plan_id=NULL,
         status='active',
         current_period_end=v_new_end,
         mp_status='authorized',
         mp_last_payment_id=p_invoice_id,
         mp_last_payment_status='approved',
         mp_last_payment_at=p_paid_at,
         updated_at=now()
   WHERE business_id=p_business_id;
  RETURN jsonb_build_object('applied',true,'current_period_end',v_new_end,'plan_id',v_plan_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.agenda_mp_apply_verified_invoice(uuid,text,text,bigint,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_mp_apply_verified_invoice(uuid,text,text,bigint,text,text,timestamptz)
  TO service_role;
