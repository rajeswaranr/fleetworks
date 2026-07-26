-- ============ FleetWorks — bill storage bucket ============
-- Run once in Supabase SQL Editor. Private "bills" bucket: each user can
-- only read/write files under their own uid folder (bills/<uid>/...).

insert into storage.buckets (id, name, public)
values ('bills', 'bills', false)
on conflict (id) do nothing;

drop policy if exists bills_owner_rw on storage.objects;
create policy bills_owner_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'bills' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'bills' and (storage.foldername(name))[1] = auth.uid()::text);

-- Verify: select id, public from storage.buckets where id = 'bills';
