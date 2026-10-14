-- Agenda Pro: canal interno de suporte (uma conversa por empresa).
-- As regras de acesso ficam no banco; nenhum usuário pode consultar outra empresa.
CREATE TABLE IF NOT EXISTS public.agenda_support_threads (
  business_id uuid PRIMARY KEY REFERENCES public.agenda_businesses(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  last_sender_kind text CHECK (last_sender_kind IN ('customer','support'))
);

CREATE TABLE IF NOT EXISTS public.agenda_support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.agenda_support_threads(business_id) ON DELETE CASCADE,
  sender_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  sender_kind text NOT NULL CHECK (sender_kind IN ('customer','support')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agenda_support_messages_business_created_idx
  ON public.agenda_support_messages(business_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agenda_support_threads_recent_idx
  ON public.agenda_support_threads(last_message_at DESC NULLS LAST);

ALTER TABLE public.agenda_support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_support_threads_select ON public.agenda_support_threads;
CREATE POLICY agenda_support_threads_select ON public.agenda_support_threads
  FOR SELECT TO authenticated
  USING (agenda_private.is_platform_admin() OR agenda_private.is_member(business_id));

DROP POLICY IF EXISTS agenda_support_threads_insert ON public.agenda_support_threads;
CREATE POLICY agenda_support_threads_insert ON public.agenda_support_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (agenda_private.is_platform_admin() OR agenda_private.is_member(business_id))
  );

DROP POLICY IF EXISTS agenda_support_threads_admin_update ON public.agenda_support_threads;
CREATE POLICY agenda_support_threads_admin_update ON public.agenda_support_threads
  FOR UPDATE TO authenticated
  USING (agenda_private.is_platform_admin())
  WITH CHECK (agenda_private.is_platform_admin());

DROP POLICY IF EXISTS agenda_support_messages_select ON public.agenda_support_messages;
CREATE POLICY agenda_support_messages_select ON public.agenda_support_messages
  FOR SELECT TO authenticated
  USING (agenda_private.is_platform_admin() OR agenda_private.is_member(business_id));

DROP POLICY IF EXISTS agenda_support_messages_insert ON public.agenda_support_messages;
CREATE POLICY agenda_support_messages_insert ON public.agenda_support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND (
      (sender_kind = 'support' AND agenda_private.is_platform_admin())
      OR (sender_kind = 'customer' AND agenda_private.is_member(business_id))
    )
  );

-- Diminui a superfície de escrita: status de conversa só pode ser alterado
-- pelo administrador, nunca pelo assinante.
REVOKE ALL ON public.agenda_support_threads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agenda_support_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agenda_support_threads, public.agenda_support_messages TO authenticated;
GRANT INSERT (business_id,created_by) ON public.agenda_support_threads TO authenticated;
GRANT UPDATE (status) ON public.agenda_support_threads TO authenticated;
GRANT INSERT (business_id,sender_id,sender_kind,body) ON public.agenda_support_messages TO authenticated;

-- Atualização automática da ordem da caixa de entrada ao receber mensagens.
-- Trigger executa com privilégios do definidor para evitar liberar UPDATE
-- de status, datas ou remetente para assinantes.
CREATE OR REPLACE FUNCTION agenda_private.update_support_thread_activity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  UPDATE public.agenda_support_threads
  SET updated_at = now(), last_message_at = NEW.created_at,
      last_sender_kind = NEW.sender_kind,
      status = CASE WHEN NEW.sender_kind = 'customer' THEN 'open' ELSE status END
  WHERE business_id = NEW.business_id;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION agenda_private.update_support_thread_activity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS agenda_support_message_activity ON public.agenda_support_messages;
CREATE TRIGGER agenda_support_message_activity
AFTER INSERT ON public.agenda_support_messages
FOR EACH ROW EXECUTE FUNCTION agenda_private.update_support_thread_activity();

COMMENT ON TABLE public.agenda_support_threads IS 'Conversa de suporte interna, uma por empresa; administrada pelo dono do Agenda Pro.';
COMMENT ON TABLE public.agenda_support_messages IS 'Mensagens de suporte restritas por RLS a membros da empresa e administradores da plataforma.';
