import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const cloudstoreSource = readFileSync(resolve(__dirname, '../js/cloudstore.js'), 'utf8');

function createElementStub() {
  return {
    id: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    value: '',
    style: {},
    dataset: {},
    children: [],
    listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
    remove() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return null; },
    closest() { return null; },
    click() {},
    focus() {},
    blur() {},
    classList: { add() {}, remove() {}, toggle() {} }
  };
}

function loadCloudstore() {
  const storage = new Map();
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
    clear() { storage.clear(); }
  };

  const document = {
    head: createElementStub(),
    body: createElementStub(),
    createElement(tag) { return createElementStub(tag); },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };

  const location = {
    origin: 'http://localhost',
    pathname: '/fleet.html',
    search: '',
    hash: '',
    href: 'http://localhost/fleet.html',
    reload() { this.reloaded = true; },
  };
  const fetchCalls = [];
  const window = {
    document,
    localStorage,
    location,
    confirm: () => true,
    toast: () => {},
    FW_BACKEND: { url: 'https://example.test', anonKey: 'anon' },
    console,
    setTimeout,
    clearTimeout,
    fetch: async (url, options = {}) => {
      fetchCalls.push([url, options]);
      const bodyText = typeof options.body === 'string' ? options.body : '';
      const body = bodyText ? JSON.parse(bodyText) : {};
      const path = url.split('?')[0];

      if (path.endsWith('/auth/v1/token') && options.method === 'POST' && url.includes('grant_type=password')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'access-' + body.email,
            refresh_token: 'refresh-' + body.email,
            user: {
              id: 'user-' + body.email,
              email: body.email,
              app_metadata: body.email === 'admin@example.com' ? { role: 'admin' } : {}
            }
          })
        };
      }
      if (path.endsWith('/rest/v1/fleets') && options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (path.endsWith('/rest/v1/fleets') && options.method === 'GET') {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (path.endsWith('/rest/v1/fleets') && options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (path.endsWith('/rest/v1/fleets') && options.method === 'GET') {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (path.endsWith('/auth/v1/recover') && options.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (path.endsWith('/auth/v1/user') && options.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'recovered-user', email: 'recover@example.com' })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
  };
  window.window = window;
  window.globalThis = window;

  const sandbox = { window, document, localStorage, console, setTimeout, clearTimeout, fetch: window.fetch, location, confirm: window.confirm, URLSearchParams, globalThis: window };
  vm.createContext(sandbox);
  vm.runInContext(cloudstoreSource, sandbox, { filename: 'cloudstore.js' });

  return { window, localStorage, fetchCalls };
}

test('keeps each signed-in account in its own session slot', async () => {
  const { window, localStorage } = loadCloudstore();
  const fwCloud = window.fwCloud;

  await fwCloud.login('user1@example.com', 'secret-1');
  assert.equal(fwCloud.user(), 'user1@example.com');
  assert.ok(localStorage.getItem('fw_session:user1@example.com'));

  await fwCloud.login('user2@example.com', 'secret-2');
  assert.equal(fwCloud.user(), 'user2@example.com');
  assert.ok(localStorage.getItem('fw_session:user2@example.com'));
  assert.equal(localStorage.getItem('fw_session:active'), 'fw_session:user2@example.com');
});

test('login only creates a session and does not pull owner fleet data', async () => {
  const { window, fetchCalls } = loadCloudstore();

  await window.fwCloud.login('partner@example.com', 'secret-1');

  assert.equal(window.fwCloud.user(), 'partner@example.com');
  assert.equal(fetchCalls.some(([u]) => u.includes('/rest/v1/fleets')), false);
});

test('admin accounts are classified before owner or partner lookups', async () => {
  const { window, fetchCalls } = loadCloudstore();

  await window.fwCloud.login('admin@example.com', 'secret-1');
  const kind = await window.fwCloud.accountKind();

  assert.equal(kind, 'admin');
  assert.equal(window.fwCloud.accountKindCached(), 'admin');
  assert.equal(fetchCalls.some(([u]) => u.includes('/rest/v1/memberships')), false);
  assert.equal(fetchCalls.some(([u]) => u.includes('/rest/v1/vendor_applications')), false);
});

test('logout removes only the active session and preserves the previous account', async () => {
  const { window, localStorage } = loadCloudstore();
  const fwCloud = window.fwCloud;

  await fwCloud.login('user1@example.com', 'secret-1');
  await fwCloud.login('user2@example.com', 'secret-2');
  await fwCloud.logout();

  assert.equal(localStorage.getItem('fw_session:user2@example.com'), null);
  assert.equal(localStorage.getItem('fw_session:active'), null);
  assert.ok(localStorage.getItem('fw_session:user1@example.com'));
});

test('requestPasswordReset sends a Supabase recovery email with a FleetWorks redirect', async () => {
  const { window, fetchCalls } = loadCloudstore();

  await window.fwCloud.requestPasswordReset('recover@example.com');

  const [url, options] = fetchCalls.find(([u]) => u.includes('/auth/v1/recover'));
  assert.match(url, /\/auth\/v1\/recover\?redirect_to=/);
  assert.match(decodeURIComponent(url), /http:\/\/localhost\/reset\.html\?email=recover%40example\.com/);
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { email: 'recover@example.com' });
});

test('signup uses server-side owner signup when configured', async () => {
  const { window, localStorage, fetchCalls } = loadCloudstore();
  window.FW_BACKEND.ownerSignupUrl = 'https://example.test/functions/v1/owner-signup';

  const result = await window.fwCloud.signup('OWNER@example.com', 'new-secret', {
    full_name: 'Owner',
    transport_name: 'Owner Transport'
  });

  assert.equal(result, 'ready');
  const [url, options] = fetchCalls.find(([u]) => u.endsWith('/functions/v1/owner-signup'));
  assert.equal(url, 'https://example.test/functions/v1/owner-signup');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), {
    email: 'owner@example.com',
    password: 'new-secret',
    profile: { full_name: 'Owner', transport_name: 'Owner Transport' }
  });
  assert.equal(fetchCalls.some(([u]) => u.includes('/auth/v1/signup')), false);
  assert.ok(localStorage.getItem('fw_session:owner@example.com'));
});

test('partner signup bypasses the server-side owner signup endpoint', async () => {
  const { window, fetchCalls } = loadCloudstore();
  window.FW_BACKEND.ownerSignupUrl = 'https://example.test/functions/v1/owner-signup';

  await window.fwCloud.signup('partner@example.com', 'new-secret', {
    fleetworks_role: 'partner',
    role: 'partner',
    business_name: 'Partner Workshop'
  });

  assert.equal(fetchCalls.some(([u]) => u.endsWith('/functions/v1/owner-signup')), false);
  assert.equal(fetchCalls.some(([u]) => u.includes('/auth/v1/signup')), true);
});

test('recovery links opened on a non-reset page are forwarded to reset.html', () => {
  const { window } = loadCloudstore();
  window.location.hash = '#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery&token_type=bearer';
  window.location.replacedWith = '';
  window.location.replace = (url) => { window.location.replacedWith = url; };

  assert.equal(window.fwCloud.forwardRecoveryToReset(), true);
  assert.equal(window.location.replacedWith, 'http://localhost/reset.html#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery&token_type=bearer');
});

test('updatePasswordFromRecovery uses the recovery access token and stores the session', async () => {
  const { window, localStorage, fetchCalls } = loadCloudstore();
  window.location.hash = '#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery&token_type=bearer';

  assert.equal(window.fwCloud.recoveryPending(), true);
  await window.fwCloud.updatePasswordFromRecovery('new-secret');

  const [, options] = fetchCalls.find(([u]) => u.endsWith('/auth/v1/user'));
  assert.equal(options.method, 'PUT');
  assert.equal(options.headers.Authorization, 'Bearer recovery-access');
  assert.deepEqual(JSON.parse(options.body), { password: 'new-secret' });
  assert.ok(localStorage.getItem('fw_session:recover@example.com'));
  assert.equal(window.fwCloud.user(), 'recover@example.com');
});
