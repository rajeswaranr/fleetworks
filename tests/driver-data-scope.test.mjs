import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const read = (p) => readFileSync(resolve(here, p), 'utf8');
const migration = read('../supabase/migrations/20260921100000_restrict_driver_data.sql');
const team = read('../js/modules/team-access/controllers/team.controller.js');

test('blanket "any org member" policies that defeat driver scoping are removed', () => {
  for (const policy of ['org_members_all_driver_ledger', 'org_members_all_vehicles', 'vehicles_rw',
    'org_members_all_parts', 'org_members_all_payment_requests', 'parties_member_all',
    'wa_contacts_member', 'wol_member_all']) {
    assert.match(migration, new RegExp(`drop policy if exists ${policy} on`), `${policy} not dropped`);
  }
});

test('tables that lose their only policy get an explicit owner/manager one', () => {
  for (const table of ['payment_requests', 'parties', 'whatsapp_contacts']) {
    assert.match(migration, new RegExp(String.raw`create policy \w+ on ${table}[\s\S]{0,120}is_org_admin\(org_id\)`));
  }
});

test('a driver sees only their own khata, and only when their login is linked to a driver record', () => {
  assert.match(team, /async function loadMyKhata/);
  assert.match(team, /ROLE !== "driver"/);
  assert.match(team, /driver_id=eq\.\$\{_myDriverId\}/);
  assert.match(team, /rows = all\.filter\(r => r\.driver_id === _myDriverId\)/);
  assert.match(team, /isn't linked to a driver record/);
});

test('the vehicle view shows details and maintenance but no purchase or repair costs', () => {
  assert.match(team, /Vehicle details/);
  assert.match(team, /Maintenance &amp; service/);
  assert.doesNotMatch(team, /purchase_price|resale_value|final_cost|est_cost/);
});
