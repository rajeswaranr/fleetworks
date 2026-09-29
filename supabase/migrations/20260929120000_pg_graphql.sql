-- GraphQL over the existing tables (pg_graphql): the same data, read as a graph of
-- linked records. Every foreign key becomes a field in both directions, e.g.
--   vehicles → driversCollection, tripsCollection, devicesCollection { deviceEventsCollection }
-- Endpoint: https://<project>.supabase.co/graphql/v1  (apikey + the user's JWT).
--
-- Security is exactly the REST API's: pg_graphql only exposes the tables a role has
-- SELECT on, and row-level security then decides which rows come back. The anon role has
-- SELECT on none of the tenant tables, so an anonymous GraphQL request sees an empty
-- schema (the collection fields do not exist) — verified: it answers
--   {"errors":[{"message":"Unknown field \"vehiclesCollection\" on type Query"}]}.
-- A signed-in user gets their org's rows and nothing else. No extra grants are needed,
-- and none should be added: SELECT on these tables belongs to `authenticated` only.

create extension if not exists pg_graphql;

-- camelCase field names (trip_date → tripDate) and a hard cap on rows per collection
comment on schema public is e'@graphql({"inflect_names": true, "max_rows": 200})';
