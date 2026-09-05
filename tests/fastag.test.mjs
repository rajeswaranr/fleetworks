/* Two bits of FASTag logic worth pinning down.

   The recharge link is owner-supplied text that later becomes the target of a
   window.open in the owner's own session, so the scheme check is a security
   guard, not tidiness — a javascript: URL saved once would run for anyone who
   clicked Recharge afterwards.

   The suggested amount is money shown to somebody deciding how much to pay, so
   it has to come from their own history rather than a number we like. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const fleetJs = readFileSync(resolve(__dirname, '../js/fleet.js'), 'utf8');

/* ---------- the recharge-link scheme guard ---------- */

// The literal is lifted straight out of fastagSetLink, so loosening the guard
// in fleet.js changes what this test exercises rather than leaving it passing
// against a copy.
const guardLine = fleetJs.split('\n').find((l) => l.includes('.test(trimmed)'));
assert.ok(guardLine, 'recharge-link scheme guard not found in fleet.js');
const literal = guardLine.match(/(\/\^.*?\/i)\.test\(trimmed\)/)[1];
const accepts = new Function('url', `return ${literal}.test(url);`);
const guard = (url) => accepts(url);

test('the recharge link accepts only http and https', () => {
  for (const ok of ['https://www.icicibank.com/fastag', 'http://example.in/recharge']) {
    assert.equal(guard(ok), true, `should accept ${ok}`);
  }
  for (const bad of [
    'javascript:alert(document.cookie)',
    'JavaScript:fetch("//evil")',
    'data:text/html,<script>1</script>',
    'file:///etc/passwd',
    'vbscript:msgbox',
    'www.icicibank.com',
  ]) {
    assert.equal(guard(bad), false, `should reject ${bad}`);
  }
});

/* ---------- the suggested recharge amount ---------- */

function loadSuggest(expenses, acct) {
  const sandbox = {
    console,
    db: { expenses, vehicles: [] },
    // Only the branch under test needs a real projection.
    fastagProjected: () => (acct && acct.__rate ? { rate: acct.__rate } : { rate: 0 }),
    FASTAG: [],
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const start = fleetJs.indexOf('function fastagSuggestedAmount(');
  const end = fleetJs.indexOf('\n}', start) + 2;
  vm.runInContext(fleetJs.slice(start, end), sandbox, { filename: 'fastag.js' });
  return sandbox.fastagSuggestedAmount;
}

const ex = (vehicleId, amount) => ({ vehicleId, category: 'FASTag Recharge', amount });

test('suggests the median of this vehicle\'s own past recharges', () => {
  const f = loadSuggest([ex('v1', 2000), ex('v1', 3000), ex('v1', 4000)]);
  assert.equal(f('v1', null), 3000);
});

test('one unusual top-up does not drag the suggestion', () => {
  // A mean would give 8500 here; the median stays where the owner actually lives.
  const f = loadSuggest([ex('v1', 2000), ex('v1', 2000), ex('v1', 2000), ex('v1', 30000)]);
  assert.equal(f('v1', null), 2000);
});

test('another vehicle\'s recharges are not borrowed', () => {
  const f = loadSuggest([ex('v2', 9000), ex('v2', 9000)], { __rate: 0 });
  assert.equal(f('v1', null), 2000, 'falls back rather than using v2 history');
});

test('with no history it uses a month at the measured daily burn', () => {
  const f = loadSuggest([], { __rate: 120 });          // 120/day * 30 = 3600 -> 3500
  assert.equal(f('v1', { __rate: 120 }), 3500);
});

test('never suggests less than 500', () => {
  const f = loadSuggest([ex('v1', 100)]);
  assert.equal(f('v1', null), 500);
});

/* ---------- the "is anyone topping this up?" check ---------- */

function loadCheck({ log = [], balance, balanceAt, threshold = 1000, rate = 100 }) {
  const sandbox = {
    console, Date, Math,
    FASTAG_LOG: { a1: log },
    fastagDailySpend: () => rate,
    fastagProjected: (acct) => {
      const elapsed = (Date.now() - new Date(acct.balance_at)) / 86400000;
      return {
        balance: Math.max(0, acct.balance - rate * elapsed),
        rate, daysLeft: null, stale: elapsed > 14,
      };
    },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const fn of ['fastagTopUpGap', 'fastagAutoRechargeCheck']) {
    const start = fleetJs.indexOf(`function ${fn}(`);
    vm.runInContext(fleetJs.slice(start, fleetJs.indexOf('\n}', start) + 2), sandbox, { filename: 'chk.js' });
  }
  return () => sandbox.fastagAutoRechargeCheck({ id: 'a1', balance, balance_at: balanceAt, low_threshold: threshold });
}

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const obs = (d, balance) => ({ account_id: 'a1', balance, recorded_at: ago(d) });

test('a healthy tag above its threshold is not flagged', () => {
  const f = loadCheck({ balance: 5000, balanceAt: ago(1), log: [obs(30, 1000), obs(29, 5000)] });
  assert.equal(f().state, 'ok');
});

test('low with no top-up for far longer than usual is flagged', () => {
  // Rises 69, 59 and 49 days ago — a steady 10-day cadence — then nothing,
  // while the balance sat low. 49 days of silence against a 10-day habit.
  const f = loadCheck({
    balance: 400, balanceAt: ago(2),
    log: [obs(70, 200), obs(69, 4000), obs(60, 300), obs(59, 4000), obs(50, 200), obs(49, 4000)],
  });
  const r = f();
  assert.equal(r.state, 'not_topping_up');
  assert.equal(r.typicalDays, 10);
});

test('low but topped up recently is not flagged', () => {
  const f = loadCheck({
    balance: 900, balanceAt: ago(1),
    log: [obs(30, 200), obs(29, 4000), obs(20, 300), obs(19, 4000), obs(3, 200), obs(2, 4000)],
  });
  assert.equal(f().state, 'ok');
});

/* The conservative half. A hand-entered balance means no reading is not the
   same as no top-up, and a false alarm trains owners to ignore the real one. */
test('a stale reading reports unknown, never broken', () => {
  const f = loadCheck({ balance: 400, balanceAt: ago(40), log: [obs(60, 200), obs(59, 4000)] });
  assert.equal(f().state, 'unknown');
});

test('no top-up history at all reports unknown', () => {
  const f = loadCheck({ balance: 400, balanceAt: ago(2), log: [obs(5, 400)] });
  assert.equal(f().state, 'unknown');
});
