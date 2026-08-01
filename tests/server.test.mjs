import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/static-server.mjs';

test('serves index.html from the app root', async (t) => {
  const server = await startServer({ port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /FleetWorks/);
});

test('returns 404 for missing files', async (t) => {
  const server = await startServer({ port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/does-not-exist.html`);
  assert.equal(response.status, 404);
});

test('serves the main FleetApp HTML pages', async (t) => {
  const server = await startServer({ port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const pages = ['index.html', 'dashboard.html', 'fleet.html', 'driver.html', 'garage.html', 'partner.html', 'team.html', 'admin.html', 'my.html', 'signin.html', 'reset.html', 'why.html', 'privacy.html'];

  for (const page of pages) {
    const response = await fetch(`http://127.0.0.1:${address.port}/${page}`);
    assert.equal(response.status, 200, `${page} should be served`);
  }
});
