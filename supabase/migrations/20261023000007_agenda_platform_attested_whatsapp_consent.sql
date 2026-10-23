-- Record consent relayed by the platform owner without pretending that a
-- specific tenant user signed into the system and approved through auth.uid().
alter table agenda_private.whatsapp_migration_reviews
  add column if not exists platform_reported_consent_at timestamptz,
  add column if not exists platform_reported_consent_note text;

comment on column agenda_private.whatsapp_migration_reviews.platform_reported_consent_at is
  'Platform operator reported having received consent from customer outside app; consent_confirmed_by remains null unless signed-in company owner confirms.';
