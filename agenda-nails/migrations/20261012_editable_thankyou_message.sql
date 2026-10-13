-- Mensagem de agradecimento personalizada por empresa, sem ativar envios.
ALTER TABLE public.agenda_business_preferences
  ADD COLUMN IF NOT EXISTS thank_you_message text;
ALTER TABLE public.agenda_business_preferences
  DROP CONSTRAINT IF EXISTS agenda_thank_you_message_length;
ALTER TABLE public.agenda_business_preferences
  ADD CONSTRAINT agenda_thank_you_message_length CHECK (
    thank_you_message IS NULL OR
    (char_length(thank_you_message) BETWEEN 1 AND 1600 AND length(btrim(thank_you_message))>0)
  );
COMMENT ON COLUMN public.agenda_business_preferences.thank_you_message
  IS 'Texto personalizado de agradecimento, com {{cliente}} e {{empresa}}. NULL usa o modelo padrão. Envio depende do campo send_thank_you_after_service.';
