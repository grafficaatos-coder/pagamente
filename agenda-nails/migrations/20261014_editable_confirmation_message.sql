-- Modelo de confirmação de agendamento por empresa. NULL mantém o texto padrão.
ALTER TABLE public.agenda_business_preferences
  ADD COLUMN IF NOT EXISTS confirmation_message text;

ALTER TABLE public.agenda_business_preferences
  DROP CONSTRAINT IF EXISTS agenda_confirmation_message_length;

ALTER TABLE public.agenda_business_preferences
  ADD CONSTRAINT agenda_confirmation_message_length CHECK (
    confirmation_message IS NULL OR
    (char_length(confirmation_message) BETWEEN 1 AND 1600 AND length(btrim(confirmation_message))>0)
  );

COMMENT ON COLUMN public.agenda_business_preferences.confirmation_message
  IS 'Texto da confirmação de agendamento por empresa. Variáveis: {{cliente}}, {{empresa}}, {{data}}, {{horario}}, {{servico}}, {{profissional}}. NULL usa o texto padrão. Personalização usada no Baileys e no envio manual; envio oficial Meta segue template aprovado.';
