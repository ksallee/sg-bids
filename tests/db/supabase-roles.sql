-- The roles and default grants a Supabase project starts with, stubbed for the throwaway test
-- database. The tests then meet the same defaults the hosted project has: `anon` and
-- `authenticated` get every table and function by default privilege, `service_role` bypasses row
-- level security, and PostgREST logs in as `authenticator`.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password :'auth_password';
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
