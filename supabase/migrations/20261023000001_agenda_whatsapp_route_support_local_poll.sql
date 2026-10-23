-- Preserva rotas existentes Railway; permite somente o destino privado de teste.
alter table public.agenda_whatsapp_runtime_routes
  drop constraint if exists agenda_whatsapp_runtime_routes_runtime_prefix_check,
  drop constraint if exists agenda_whatsapp_runtime_routes_service_url_check;
alter table public.agenda_whatsapp_runtime_routes
  add constraint agenda_whatsapp_runtime_routes_supported_backend_check
  check (
    (runtime_prefix='railway:' and service_url ~ '^https://')
    or (runtime_prefix='local-poll:' and service_url='supabase-poll://local')
  );