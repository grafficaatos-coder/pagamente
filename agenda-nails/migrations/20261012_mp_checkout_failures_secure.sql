-- Mercado Pago checkout rejection diagnostics. Server-only, no sensitive payload.
CREATE TABLE IF NOT EXISTS public.agenda_mp_checkout_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.agenda_businesses(id),
  provider_http_status integer NOT NULL CHECK (provider_http_status BETWEEN 400 AND 599),
  provider_code text NOT NULL DEFAULT '',
  provider_message text NOT NULL DEFAULT '',
  credential_mode text NOT NULL CHECK (credential_mode IN ('production','test','unknown')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agenda_mp_checkout_failures_recent
  ON public.agenda_mp_checkout_failures(business_id,created_at DESC);
ALTER TABLE public.agenda_mp_checkout_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_mp_checkout_failures FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.agenda_mp_checkout_failures_id_seq FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE public.agenda_mp_checkout_failures TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.agenda_mp_checkout_failures_id_seq TO service_role;
