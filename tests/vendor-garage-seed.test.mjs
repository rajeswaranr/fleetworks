import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGarageSeed,
  buildStorageState,
  summarizeGarageSeed,
} from '../scripts/seed-vendor-garage-data.mjs';

test('vendor garage seed generates broad workflow coverage', () => {
  const seed = buildGarageSeed({ count: 200, seed: 'unit-test-vendor' });
  const summary = summarizeGarageSeed(seed);

  assert.equal(summary.jobs, 200);
  for (const status of ['Planned', 'Estimate Sent', 'Approved', 'In Progress', 'Completed', 'Delivered']) {
    assert.equal(summary.statusCounts[status] > 0, true, `${status} should be represented`);
  }
  assert.equal(summary.estimates > 100, true);
  assert.equal(summary.inspections > 50, true);
  assert.equal(summary.completedOrDelivered > 50, true);
  assert.equal(summary.lowStock > 0, true);
  assert.equal(summary.openComplaints > 0, true);
  assert.equal(seed.jobs.some(job => job.estimate?.status === 'Rejected'), true);
  assert.equal(seed.jobs.some(job => job.photos?.length), true);
});

test('vendor garage seed can be packed into Playwright storage state', () => {
  const garageData = buildGarageSeed({ count: 5, seed: 'storage-state-test' });
  const state = buildStorageState({
    origin: 'http://localhost:8090',
    garageData,
  });

  assert.equal(state.origins[0].origin, 'http://localhost:8090');
  const storage = Object.fromEntries(state.origins[0].localStorage.map(item => [item.name, item.value]));
  assert.equal(JSON.parse(storage.fw_garage).jobs.length, 5);
  assert.equal(Object.keys(storage).some(key => key.startsWith('fw_session:')), false);
  assert.equal(storage['fw_session:active'], undefined);
  assert.equal(JSON.stringify(state).includes('access_token'), false);
  assert.equal(JSON.stringify(state).includes('refresh_token'), false);
});
