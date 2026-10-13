-- Agenda Pro PIX mensal: cobranca avulsa com liberacao apenas apos verificacao do MP.
-- Nao modifica dados de assinaturas existentes. Restrito ao piloto no backend.
CREATE TABLE IF NOT EXISTS public.agenda_mp_pix_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.agenda_businesses(id),
  plan_id uuid NOT NULL REFERENCES public.agenda_plans(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  external_reference text NOT NULL UNIQUE,
  mp_payment_id text UNIQUE,
  checkout_url text,
  status text NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating','pending','approved','expired','failed')),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agenda_mp_pix_charges_one_open_per_business
  ON public.agenda_mp_pix_charges (business_id)
  WHERE status IN ('creating','pending');
CREATE INDEX IF NOT EXISTS agenda_mp_pix_charges_business_created
  ON public.agenda_mp_pix_charges (business_id,created_at DESC);
ALTER TABLE public.agenda_mp_pix_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agenda_mp_pix_charges FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.agenda_mp_pix_charges TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_mp_apply_verified_pix(
 p_charge_id uuid,p_payment_id text,p_amount_cents bigint,
 p_currency text,p_provider_status text,p_paid_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public
AS $function$
DECLARE
 c public.agenda_mp_pix_charges%ROWTYPE;
 s public.agenda_subscriptions%ROWTYPE;
 v_price bigint;
 v_active boolean;
 v_blocked boolean;
 v_end timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';
 END IF;
 IF p_charge_id IS NULL OR p_payment_id IS NULL OR length(p_payment_id) NOT BETWEEN 1 AND 40
    OR p_currency IS DISTINCT FROM 'BRL'
    OR p_provider_status IS DISTINCT FROM 'approved'
    OR p_amount_cents IS NULL OR p_amount_cents <= 0
    OR p_paid_at IS NULL OR p_paid_at > now()+interval '10 minutes'
    OR p_paid_at < now()-interval '180 days' THEN
    RAISE EXCEPTION 'invalid_payment';
 END IF;
 SELECT * INTO c FROM public.agenda_mp_pix_charges WHERE id=p_charge_id FOR UPDATE;
 IF NOT FOUND OR c.mp_payment_id IS DISTINCT FROM p_payment_id
    OR c.amount_cents IS DISTINCT FROM p_amount_cents THEN
   RAISE EXCEPTION 'charge_mismatch';
 END IF;
 IF c.status='approved' THEN
   RETURN jsonb_build_object('applied',false,'reason','duplicate');
 END IF;
 IF c.status NOT IN ('creating','pending','expired') OR
    p_paid_at<c.created_at-interval '10 minutes' OR
    p_paid_at>c.expires_at+interval '10 minutes' THEN
   RAISE EXCEPTION 'invalid_charge_state';
 END IF;
 SELECT * INTO s FROM public.agenda_subscriptions
 WHERE business_id=c.business_id FOR UPDATE;
 IF NOT FOUND OR s.status IN ('cancelled','suspended')
    OR s.mp_preapproval_id IS NOT NULL THEN
   RAISE EXCEPTION 'subscription_unavailable';
 END IF;
 SELECT p.monthly_price_cents,p.active
 INTO v_price,v_active FROM public.agenda_plans p WHERE p.id=c.plan_id;
 IF NOT FOUND OR NOT v_active OR v_price IS DISTINCT FROM c.amount_cents
    OR v_price<>4990 THEN
   RAISE EXCEPTION 'plan_amount_mismatch';
 END IF;
 SELECT manual_blocked INTO v_blocked FROM public.agenda_businesses
 WHERE id=c.business_id FOR SHARE;
 IF v_blocked IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'business_blocked';
 END IF;
 IF s.mp_last_payment_at IS NOT NULL AND p_paid_at<=s.mp_last_payment_at THEN
   RAISE EXCEPTION 'out_of_order_payment';
 END IF;
 v_end:=greatest(coalesce(s.current_period_end,p_paid_at),p_paid_at)+interval '1 month';
 UPDATE public.agenda_subscriptions
 SET plan_id=c.plan_id,mp_pending_plan_id=NULL,
     status='active',trial_ends_at=NULL,current_period_end=v_end,
     mp_status='pix_paid',mp_last_payment_id=p_payment_id,
     mp_last_payment_status='approved',mp_last_payment_at=p_paid_at,
     updated_at=now()
 WHERE business_id=c.business_id;
 UPDATE public.agenda_mp_pix_charges
 SET status='approved',paid_at=p_paid_at,updated_at=now()
 WHERE id=c.id;
 RETURN jsonb_build_object('applied',true,'current_period_end',v_end);
END;
$function$;
REVOKE ALL ON FUNCTION public.agenda_mp_apply_verified_pix(uuid,text,bigint,text,text,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_mp_apply_verified_pix(uuid,text,bigint,text,text,timestamptz)
 TO service_role;
