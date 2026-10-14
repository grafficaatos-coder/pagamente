-- Texto personalizado do lembrete de agendamento por empresa, sem alterar a automação.
ALTER TABLE public.agenda_business_preferences
  ADD COLUMN IF NOT EXISTS reminder_message text;
ALTER TABLE public.agenda_business_preferences
  DROP CONSTRAINT IF EXISTS agenda_reminder_message_length;
ALTER TABLE public.agenda_business_preferences
  ADD CONSTRAINT agenda_reminder_message_length CHECK (
    reminder_message IS NULL OR
    (char_length(reminder_message) BETWEEN 1 AND 1600 AND length(btrim(reminder_message)) > 0)
  );
COMMENT ON COLUMN public.agenda_business_preferences.reminder_message
  IS 'Corpo do lembrete automático por empresa; variáveis {{cliente}}, {{empresa}}, {{data}}, {{horario}}, {{servico}}, {{profissional}}. O link de confirmação é adicionado automaticamente quando pendente. NULL preserva o modelo padrão.';
