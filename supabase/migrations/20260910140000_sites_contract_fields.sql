-- Extend sites with contract/billing details and client info
-- Adds: vehicle_types, billing_basis, rate, client, contract dates

alter table sites
  add column if not exists vehicle_types    text[]  default '{}',
  add column if not exists billing_basis    text    not null default 'trip'
                                            check (billing_basis in
                                              ('trip','tonnage','monthly_rental','hourly','km_based','custom')),
  add column if not exists rate_per_unit    numeric(12,2) default 0,
  add column if not exists unit_label       text    default 'Trip',
  add column if not exists target_quantity  numeric(10,2),       -- planned trips / MT / months
  add column if not exists client_name      text,
  add column if not exists client_contact   text,
  add column if not exists contract_value   numeric(14,2),       -- total contract amount
  add column if not exists contract_start   date,
  add column if not exists contract_end     date;

-- Extend site_vehicle_assignments with per-vehicle billing terms
alter table site_vehicle_assignments
  add column if not exists billing_basis  text default 'site_default'
                                          check (billing_basis in
                                            ('site_default','trip','tonnage','monthly_rental','hourly','km_based','custom')),
  add column if not exists rate_per_unit  numeric(12,2),   -- null = inherit from site
  add column if not exists unit_label     text,
  add column if not exists vehicle_type_override text;     -- override the vehicle type label for this assignment
