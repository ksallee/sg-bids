-- Default privileges: a table, view, sequence or function a later migration adds is not granted
-- to `anon` or `authenticated`.
--
-- A Supabase project grants both roles everything new in `public` by default. The first migration
-- revokes its own objects by name; this stops the default for objects created after it, by the role
-- that runs migrations (`postgres`). A function is executable by PUBLIC by default too, in every
-- schema: that default is revoked as well, so a new function is the service role's only when a
-- migration grants it. Row level security is still each new table's own line: the database tests
-- fail on a table without it (`tests/db/rls.db.test.ts`).
--
-- Idempotent: safe to apply again.

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
