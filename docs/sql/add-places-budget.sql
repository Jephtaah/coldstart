-- Adds a daily Google Places API call budget to the settings row so discovery
-- can enforce a hard per-day cap on billable Places requests. Idempotent: safe
-- to re-run.
--
-- Run in Neon's SQL Editor against the direct (non-pooled) connection:
--   ALTER TABLE settings ADD COLUMN IF NOT EXISTS places_used_date date;
--   ALTER TABLE settings ADD COLUMN IF NOT EXISTS places_used_count integer NOT NULL DEFAULT 0;

alter table settings add column if not exists places_used_date date;
alter table settings add column if not exists places_used_count integer not null default 0;
