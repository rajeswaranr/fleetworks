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

  const location = { reload() { this.reloaded = true; }, href: 'http://localhost/' };
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

      if (path.endsWith('/auth/v1/token') && options.method === 'POST' && body.grant_type === 'password') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'access-' + body.email,
            refresh_token: 'refresh-' + body.email,
            user: { id: 'user-' + body.email, email: body.email }
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
      return { ok: true, status: 200, json: async () => ({}) };
    }
  };
  window.window = window;
  window.globalThis = window;

  const sandbox = { window, document, localStorage, console, setTimeout, clearTimeout, fetch: window.fetch, location, confirm: window.confirm, globalThis: window };
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
