/* Every feature that asks "which vehicle?" must offer the whole fleet.

   The FASTag bug was not a typo — it was a picker that nothing refreshed after
   the cloud pull delivered db.vehicles, so a signed-in owner saw an empty
   dropdown forever while demo mode looked fine. That failure is invisible to a
   unit test of any single function, and the next picker added to the app would
   hit it again.

   This is a static check over the source: find every <select> whose id names a
   vehicle, and assert something is responsible for filling it. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');

const fleetJs = read('../js/modules/fleet-ops/controllers/fleet.controller.js');
const fleetHtml = read('../fleet.html');
const analyticsJs = read('../js/modules/fleet-iq/controllers/analytics.controller.js');

/* Ids listed inside fillVehicleSelects(), the canonical filler. */
function coveredByFiller() {
  const start = fleetJs.indexOf('function fillVehicleSelects()');
  assert.ok(start > -1, 'fillVehicleSelects not found');
  const body = fleetJs.slice(start, fleetJs.indexOf('\n}', start));
  return new Set([...body.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]));
}

/* Pickers filled by their own renderer rather than the shared filler. Each is
   listed with the function that owns it, so an entry here is a claim that can
   be checked — see the test below. */
const OWNED_ELSEWHERE = {
  driverVehicle: { file: fleetJs, fn: 'fillVehicleSelects' },   // handled at the tail, with a "Not assigned" option
  vehicleFilter: { file: analyticsJs, fn: 'renderAnalyticsAll' },
  iqVehicleFilter: { file: analyticsJs, fn: 'vehicleFilterControls' },
};

function vehicleSelectIds() {
  const ids = new Set();
  for (const src of [fleetJs, fleetHtml]) {
    for (const m of src.matchAll(/<select\b[^>]*\bid="([A-Za-z0-9_]*[Vv]ehicle[A-Za-z0-9_]*)"/g)) ids.add(m[1]);
    // id may precede the name attribute
    for (const m of src.matchAll(/<select\b[^>]*\bid="([A-Za-z0-9_]+)"[^>]*name="vehicleId"/g)) ids.add(m[1]);
  }
  return [...ids];
}

test('every vehicle <select> has something that fills it', () => {
  const covered = coveredByFiller();
  const missing = vehicleSelectIds().filter((id) => !covered.has(id) && !OWNED_ELSEWHERE[id]);
  assert.deepEqual(missing, [], `no filler for: ${missing.join(', ')}`);
});

test('the pickers claimed as owned elsewhere really are filled there', () => {
  for (const [id, { file, fn }] of Object.entries(OWNED_ELSEWHERE)) {
    const start = file.indexOf(`function ${fn}(`);
    assert.ok(start > -1, `${fn} not found`);
    const body = file.slice(start, start + 4000);
    assert.ok(body.includes(id), `${fn} does not touch ${id}`);
  }
});

/* renderAll() is what runs after the cloud pull hands over db.vehicles. A
   picker whose renderer is missing from it shows the state from page load —
   which for a signed-in owner is an empty fleet. This is the exact FASTag
   failure, so it is asserted rather than trusted. */
test('renderAll refreshes the pickers that depend on the fleet', () => {
  const start = fleetJs.indexOf('function renderAll()');
  const body = fleetJs.slice(start, fleetJs.indexOf('\n}', start));
  for (const fn of ['fillVehicleSelects', 'renderFastag', 'renderAnalyticsAll', 'renderTeamPicker']) {
    assert.ok(body.includes(fn + '('), `renderAll must call ${fn}()`);
  }
});

/* The bug underneath the bug: FASTag start-up lived inside
   rememberExpenseCategory(), behind two early returns, so it only ran when an
   expense was saved under a never-before-seen category. */
test('FASTag start-up is not buried inside rememberExpenseCategory', () => {
  const start = fleetJs.indexOf('function rememberExpenseCategory(');
  const body = fleetJs.slice(start, fleetJs.indexOf('\n}', start));
  for (const fn of ['loadFastag', 'bindFastagForm', 'bindFinFastagForm']) {
    assert.ok(!body.includes(fn + '('), `${fn}() must not be called from rememberExpenseCategory`);
  }
});
