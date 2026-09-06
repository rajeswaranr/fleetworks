-- ============ FleetWorks — widen the sourcing taxonomy to the full HCV trade list ============
-- The original five (mechanic/electrician/battery/tyre/puncture) only covered
-- running repairs. A truck fleet also needs body, hydraulic, fuel-system and
-- supply trades — each a separate shop on the ground and a separate search on
-- Google Maps, so each gets its own category rather than being lumped into
-- "mechanic".
--
-- The list was chosen by probing Google Maps in Chennai and keeping the trades
-- that come back with a usable category of their own:
--   hydraulic  -> "Hydraulic repair service"   (Hyva / tipper rams)
--   injector   -> "Diesel engine repair service" (FIP / Bosch diesel pumps)
--   radiator   -> "Radiator repair service"
--   spring     -> "Auto spring shop"           (leaf spring, HCV-dominant)
--   spareparts -> "Truck parts supplier"       (the cleanest HCV signal found)
--   welding    -> "Welder"
--   windshield -> "Auto glass shop"            (genuinely LMV/HCV mixed)
--
-- "painter" and "tinkering" are deliberately NOT separate categories. In India
-- denting and painting is one shop ("body works"), and Google has no category
-- for the truck body-building trade at all — it files them under
-- "Transportation service" or "Auto body parts supplier". Two categories would
-- have chased one trade and returned the same businesses twice, so they are
-- merged into 'bodyshop'.
--
-- Widening a CHECK constraint can never invalidate a row that already passes
-- the narrower one, so no existing scraper_configs data is affected.
--
-- vendor_leads.service_category is deliberately left unconstrained (free text),
-- as it also carries categories from the manual JSON-upload path.

alter table scraper_configs drop constraint if exists scraper_configs_vendor_type_check;
alter table scraper_configs add constraint scraper_configs_vendor_type_check
  check (vendor_type in (
    -- running repairs
    'mechanic', 'electrician', 'battery', 'tyre', 'puncture',
    -- systems
    'hydraulic', 'injector', 'radiator', 'spring',
    -- body trades
    'bodyshop', 'welding', 'windshield',
    -- supply
    'spareparts'
  ));

-- Verify after running:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'scraper_configs'::regclass and contype = 'c';
