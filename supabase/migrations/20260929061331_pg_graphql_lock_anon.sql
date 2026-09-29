-- Applied earlier this session via the Supabase MCP tool (recorded remotely, file added
-- afterwards to keep the local history in sync). Supabase's DDL event trigger re-grants
-- graphql_public usage to anon on every schema change, so this revoke does not persist —
-- but that is harmless: pg_graphql only exposes tables a role has SELECT on, and anon has
-- SELECT on none of the tenant tables, so an anonymous GraphQL request sees an empty schema.
-- Kept for history parity only. See 20260929120000_pg_graphql.sql.
revoke usage on schema graphql_public from anon, public;
revoke execute on all functions in schema graphql_public from anon, public;
grant usage on schema graphql_public to authenticated;
grant execute on all functions in schema graphql_public to authenticated;
