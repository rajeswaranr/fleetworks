import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const dbcoreSource = readFileSync(resolve(__dirname, '../js/dbcore.js'), 'utf8');

function loadDbcore() {
  const sandbox = {
    console,
    window: {},
    fwCloud: { user: () => ({ id: 'user-1' }), authGet: async () => [], authInsertRet: async () => null, authPatch: async () => true, authDelete: async () => true },
    db: { vehicles: [{ id: 'v-1', dbId: 'db-1' }], drivers: [{ id: 'd-1', dbId: 'db-2' }], issues: [{ id: 'i-1', dbId: 'db-3' }] },
    setTimeout,
    clearTimeout,
    globalThis: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dbcoreSource, sandbox, { filename: 'dbcore.js' });
  return sandbox;
}

test('dbRowToVehicle maps DB rows to the in-memory FleetApp shape', () => {
  const sandbox = loadDbcore();
  const row = { ext_id: 'v-1', id: 'db-1', name: 'TN-01-AB-1234', type: 'Truck', km_per_month: 9000, insurance_till: '2026-01-01', puc_till: '2026-02-01' };
  const result = sandbox.dbRowToVehicle(row);
  assert.equal(result.id, 'v-1');
  assert.equal(result.dbId, 'db-1');
  assert.equal(result.compliance.insurance, '2026-01-01');
  assert.equal(result.kmPerMonth, 9000);
});

test('driverToDbRow and issueToDbRow use the expected DB columns', () => {
  const sandbox = loadDbcore();
  const driver = { id: 'd-1', name: 'Suresh', vehicleId: 'v-1' };
  const issue = { id: 'i-1', vehicleId: 'v-1', title: 'Brake issue', status: 'Open' };
  assert.equal(sandbox.driverToDbRow(driver, 'org-1').vehicle_id, 'db-1');
  assert.equal(sandbox.issueToDbRow(issue, 'org-1').ext_id, 'i-1');
});
