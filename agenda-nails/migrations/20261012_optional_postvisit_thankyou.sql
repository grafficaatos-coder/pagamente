-- Mensagem de agradecimento por empresa: desativada por padrao.
-- Nunca enviar followups antigos quando a empresa opta por ativar.
ALTER TABLE public.agenda_business_preferences
  ADD COLUMN IF NOT EXISTS send_thank_you_after_service boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.agenda_business_preferences.send_thank_you_after_service
  IS 'Envia agradecimento por WhatsApp somente quando um atendimento muda para completed; opt-in por empresa.';

-- Desativa os lembretes antigos gerados pelo comportamento anterior.
-- Nao altera mensagens ja enviadas ou atualmente em processamento.
UPDATE public.agenda_whatsapp_queue
SET status='cancelled',updated_at=now()
WHERE message_type='followup' AND status IN ('pending','opened','queued');

CREATE OR REPLACE FUNCTION agenda_private.sync_whatsapp_queue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  declare
    v_customer_name text;
    v_customer_phone text;
    v_service_name text;
    v_duration integer := 60;
    v_reminder timestamptz;
    v_followup timestamptz;
    v_send_thankyou boolean := false;
  begin
    if tg_op='DELETE' then
      return old;
    end if;

    if new.status='cancelled' then
      update public.agenda_whatsapp_queue
      set status='cancelled',updated_at=now()
      where appointment_id=new.id and status in ('pending','opened');
      return new;
    end if;

    select c.name,c.phone into v_customer_name,v_customer_phone
    from public.agenda_customers c where c.id=new.customer_id;

    select s.name,coalesce(s.duration_minutes,60) into v_service_name,v_duration
    from public.agenda_services s where s.id=new.service_id;

    if new.starts_at > now()+interval '24 hours' then
      v_reminder:=new.starts_at-interval '24 hours';
    else
      v_reminder:=null;
    end if;

    -- Envio opcional, apenas depois do status Concluido.
    v_followup:=now()+interval '1 minute';

    insert into public.agenda_whatsapp_queue(
      business_id,appointment_id,customer_id,message_type,scheduled_for,status,
      customer_name,customer_phone,service_name,professional_name,starts_at,updated_at
    )
    values(
      new.business_id,new.id,new.customer_id,'confirmation',now(),'pending',
      v_customer_name,v_customer_phone,v_service_name,new.professional_name,new.starts_at,now()
    )
    on conflict(appointment_id,message_type) do update set
      customer_id=excluded.customer_id,
      customer_name=excluded.customer_name,
      customer_phone=excluded.customer_phone,
      service_name=excluded.service_name,
      professional_name=excluded.professional_name,
      starts_at=excluded.starts_at,
      updated_at=now();

    if v_reminder is not null then
      insert into public.agenda_whatsapp_queue(
        business_id,appointment_id,customer_id,message_type,scheduled_for,status,
        customer_name,customer_phone,service_name,professional_name,starts_at,updated_at
      )
      values(
        new.business_id,new.id,new.customer_id,'reminder',v_reminder,'pending',
        v_customer_name,v_customer_phone,v_service_name,new.professional_name,new.starts_at,now()
      )
      on conflict(appointment_id,message_type) do update set
        scheduled_for=excluded.scheduled_for,
        customer_id=excluded.customer_id,
        customer_name=excluded.customer_name,
        customer_phone=excluded.customer_phone,
        service_name=excluded.service_name,
        professional_name=excluded.professional_name,
        starts_at=excluded.starts_at,
        status=case when public.agenda_whatsapp_queue.status='done' then 'done' else 'pending' end,
        updated_at=now();
    else
      delete from public.agenda_whatsapp_queue
      where appointment_id=new.id and message_type='reminder' and status<>'done';
    end if;

    -- Fora de Concluido, nao deve restar agradecimento pendente.
    if new.status<>'completed' then
      update public.agenda_whatsapp_queue
      set status='cancelled',updated_at=now()
      where appointment_id=new.id and message_type='followup'
        and status in ('pending','opened','queued');
    else
      -- Ao ativar a preferencia nao mandar mensagens retroativas:
      -- somente o evento de conclusao gera o agradecimento.
      if tg_op='INSERT' or old.status is distinct from 'completed' then
        select coalesce(p.send_thank_you_after_service,false)
        into v_send_thankyou
        from public.agenda_business_preferences p
        where p.business_id=new.business_id;
        if coalesce(v_send_thankyou,false) and nullif(btrim(coalesce(v_customer_phone,'')),'') is not null then
          insert into public.agenda_whatsapp_queue(
            business_id,appointment_id,customer_id,message_type,scheduled_for,status,
            customer_name,customer_phone,service_name,professional_name,starts_at,updated_at
          ) values(
            new.business_id,new.id,new.customer_id,'followup',v_followup,'pending',
            v_customer_name,v_customer_phone,v_service_name,new.professional_name,new.starts_at,now()
          )
          on conflict(appointment_id,message_type) do update set
            scheduled_for=excluded.scheduled_for,
            customer_id=excluded.customer_id,
            customer_name=excluded.customer_name,
            customer_phone=excluded.customer_phone,
            service_name=excluded.service_name,
            professional_name=excluded.professional_name,
            starts_at=excluded.starts_at,
            status=case when public.agenda_whatsapp_queue.status in ('done','processing','queued')
              then public.agenda_whatsapp_queue.status else 'pending' end,
            updated_at=now();
        end if;
      end if;
    end if;

    return new;
  end;
  $function$


-- Ao desligar a opcao, cancela os envios ainda aguardando.
CREATE OR REPLACE FUNCTION agenda_private.cancel_thankyou_on_optout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF OLD.send_thank_you_after_service IS TRUE
     AND NEW.send_thank_you_after_service IS FALSE THEN
    UPDATE public.agenda_whatsapp_queue
       SET status='cancelled',updated_at=now()
     WHERE business_id=NEW.business_id AND message_type='followup'
       AND status IN ('pending','opened','queued');
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS agenda_thankyou_optout ON public.agenda_business_preferences;
CREATE TRIGGER agenda_thankyou_optout
AFTER UPDATE OF send_thank_you_after_service ON public.agenda_business_preferences
FOR EACH ROW EXECUTE FUNCTION agenda_private.cancel_thankyou_on_optout();
