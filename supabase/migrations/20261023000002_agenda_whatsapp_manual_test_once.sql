-- Allow exactly ONE manual one-off WhatsApp test for the isolated technical tenant.
-- Production queue and auto dispatch remain unchanged.
alter table public.agenda_whatsapp_local_commands
  drop constraint if exists agenda_whatsapp_local_commands_action_check;
alter table public.agenda_whatsapp_local_commands
  add constraint agenda_whatsapp_local_commands_action_check
  check (action in ('connect','disconnect','pair-code','send-test'));
alter table public.agenda_whatsapp_local_commands
  add constraint agenda_local_send_test_tenant_check
  check (action <> 'send-test' or business_id='270de0ad-2013-4afb-b8ba-2e21175b3f01'::uuid);
create unique index if not exists agenda_local_one_send_test_idx
  on public.agenda_whatsapp_local_commands(business_id)
  where action='send-test';