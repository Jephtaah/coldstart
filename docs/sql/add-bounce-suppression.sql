-- Bounce / complaint handling + email-level suppression
-- Run once against Neon (direct/non-pooled connection). Idempotent.

create table if not exists suppressed_emails (
  email text primary key,
  reason text not null default 'bounce', -- 'bounce' | 'complaint'
  created_at timestamptz not null default now()
);

alter table leads add column if not exists bounced_at timestamptz;
