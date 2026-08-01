import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const resetSource = readFileSync(resolve(__dirname, '../js/reset-password.js'), 'utf8');

function elementStub() {
  return {
    hidden: false,
    textContent: '',
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
  };
}

function inputFormStub(fields) {
  const form = elementStub();
  form.fields = fields;
  form.querySelector = (selector) => selector === '[name="email"]' ? fields.email : null;
  return form;
}

function loadResetPage() {
  const storage = new Map();
  const form = inputFormStub({
    email: { name: 'email', value: '' },
    password: { name: 'password', value: 'new-secret' },
    confirmPassword: { name: 'confirmPassword', value: 'new-secret' },
  });
  const elements = {
    resetPageForm: form,
    resetMissingToken: elementStub(),
    resetPageErr: elementStub(),
    resetPageNote: elementStub(),
  };
  const calls = [];
  const location = {
    hash: '#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery&token_type=bearer',
    search: '?email=recover%40example.com',
    pathname: '/reset.html',
    href: 'http://localhost/reset.html',
  };
  const sandbox = {
    window: {},
    document: { getElementById(id) { return elements[id] || null; } },
    location,
    history: { replaceState(_state, _title, url) { location.replacedWith = url; } },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    FormData: class {
      constructor(source) { this.source = source; }
      *[Symbol.iterator]() {
        for (const input of Object.values(this.source.fields)) yield [input.name, input.value];
      }
    },
    URLSearchParams,
    setTimeout(fn) { fn(); return 1; },
    fetch: async (url, options = {}) => {
      calls.push([url, options]);
      if (url.endsWith('/auth/v1/user')) {
        return { ok: true, json: async () => ({ id: 'user-1', email: 'recover@example.com' }) };
      }
      if (url.endsWith('/auth/v1/token?grant_type=password')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            user: { id: 'user-1', email: 'recover@example.com' },
          }),
        };
      }
      return { ok: false, json: async () => ({ error: 'unexpected' }) };
    },
    FW_BACKEND: { url: 'https://example.test', anonKey: 'anon' },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(resetSource, sandbox, { filename: 'reset-password.js' });
  return { sandbox, form, storage, calls, location };
}

test('reset password page updates Supabase Auth and stores a FleetWorks session', async () => {
  const { form, storage, calls, location } = loadResetPage();
  assert.equal(form.fields.email.value, 'recover@example.com');

  await form.listeners.submit({ preventDefault() {} });

  const [, updateOptions] = calls.find(([url]) => url.endsWith('/auth/v1/user'));
  assert.equal(updateOptions.method, 'PUT');
  assert.equal(updateOptions.headers.Authorization, 'Bearer recovery-access');
  assert.deepEqual(JSON.parse(updateOptions.body), { password: 'new-secret' });

  const [, loginOptions] = calls.find(([url]) => url.endsWith('/auth/v1/token?grant_type=password'));
  assert.deepEqual(JSON.parse(loginOptions.body), { email: 'recover@example.com', password: 'new-secret' });

  assert.ok(storage.get('fw_session:recover@example.com'));
  assert.equal(storage.get('fw_session:active'), 'fw_session:recover@example.com');
  assert.equal(location.href, 'fleet.html#account');
});
