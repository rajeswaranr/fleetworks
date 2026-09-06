/* Invoice tax arithmetic. This is a legal document stating what somebody owes,
   so the failure mode is not a wrong pixel — it is a wrong tax return.

   Two rules carry all the risk: reverse charge means the invoice carries NO
   GST, and same-state versus different-state decides CGST+SGST against IGST.
   Both are read off the GSTIN's first two digits. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const src = readFileSync(resolve(__dirname, '../js/modules/invoicing/controllers/invoices.controller.js'), 'utf8');

function load() {
  const sandbox = { console, document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [], readyState: 'complete' }, db: { settings: {} } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'invoices.js' });
  return sandbox;
}

const { invoiceTax, invoiceStateOf } = load();

test('a GSTIN yields its state code, and junk yields nothing', () => {
  assert.equal(invoiceStateOf('33ABCDE1234F1Z5'), '33');
  assert.equal(invoiceStateOf('29AAACR1234M1ZP'), '29');
  assert.equal(invoiceStateOf(''), null);
  assert.equal(invoiceStateOf('ABCDE1234F1Z5'), null);
  assert.equal(invoiceStateOf(null), null);
});

/* The one most likely to be got wrong, and the most common treatment in goods
   transport: the invoice must carry no tax at all. */
test('reverse charge adds no tax whatsoever', () => {
  const t = invoiceTax(50000, 'rcm', '33', '29');
  assert.deepEqual(
    { cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total },
    { cgst: 0, sgst: 0, igst: 0, total: 50000 },
  );
});

test('exempt adds no tax either', () => {
  const t = invoiceTax(12345, 'exempt', '33', '33');
  assert.equal(t.total, 12345);
  assert.equal(t.cgst + t.sgst + t.igst, 0);
});

test('same state splits into CGST and SGST, not IGST', () => {
  const t = invoiceTax(10000, 'forward_12', '33', '33');
  assert.equal(t.igst, 0);
  assert.equal(t.cgst, 600);
  assert.equal(t.sgst, 600);
  assert.equal(t.total, 11200);
});

test('different states charge IGST, not CGST/SGST', () => {
  const t = invoiceTax(10000, 'forward_12', '33', '29');
  assert.equal(t.cgst, 0);
  assert.equal(t.sgst, 0);
  assert.equal(t.igst, 1200);
  assert.equal(t.total, 11200);
});

test('5% and 18% both compute correctly', () => {
  assert.equal(invoiceTax(20000, 'forward_5', '33', '33').total, 21000);
  assert.equal(invoiceTax(20000, 'forward_18', '33', '29').igst, 3600);
});

/* An odd number of paise must not vanish or be double-counted when halved. */
test('the CGST and SGST halves always sum to the tax exactly', () => {
  for (const taxable of [1000.1, 333.33, 7777.77, 19999.99, 1, 0.01]) {
    for (const treatment of ['forward_5', 'forward_12', 'forward_18']) {
      const t = invoiceTax(taxable, treatment, '33', '33');
      const tax = Math.round((t.cgst + t.sgst) * 100) / 100;
      const expected = Math.round(Math.round(t.taxable * t.rate) ) / 100;
      assert.equal(tax, expected, `${taxable} @ ${treatment}: halves ${tax} vs tax ${expected}`);
      assert.equal(Math.round((t.taxable + tax) * 100) / 100, t.total);
    }
  }
});

/* An unknown place of supply is treated as intra-state — the common local
   consignor — rather than silently defaulting to IGST, which would understate
   nothing but would file the tax to the wrong government. */
test('an unknown place of supply is treated as intra-state', () => {
  const t = invoiceTax(10000, 'forward_12', '33', null);
  assert.equal(t.igst, 0);
  assert.equal(t.cgst + t.sgst, 1200);
});

test('a zero invoice stays zero rather than producing NaN', () => {
  const t = invoiceTax(0, 'forward_12', '33', '33');
  assert.equal(t.total, 0);
  assert.ok(Number.isFinite(t.cgst) && Number.isFinite(t.sgst));
});

/* ---------- GSTIN validation ----------
   A wrong GSTIN on an issued invoice is a document the customer's accountant
   rejects, so the published check-character algorithm is worth running at entry.
   The tests below never assert "this sample is valid" on faith — the checksum is
   computed and compared, and mutations are required to break it. */

const { gstinProblem, gstinCheckChar } = load();

test('the check character is self-consistent for well-formed GSTINs', () => {
  // Build valid GSTINs by computing the 15th character, then confirm the
  // validator accepts exactly those.
  for (const first14 of ['27AAPFU0939F1Z', '33ABCDE1234F1Z', '29AAGCB7383J1Z']) {
    const full = first14 + gstinCheckChar(first14);
    assert.equal(gstinProblem(full), null, `${full} should validate`);
  }
});

test('a single mistyped character is caught', () => {
  const base = '27AAPFU0939F1Z';
  const good = base + gstinCheckChar(base);
  // Change one PAN letter; the check character no longer matches.
  const bad = '27AAPFU0939F1Z' .replace('AAPFU', 'AAPFV');
  const badFull = bad + good[14];
  assert.ok(gstinProblem(badFull), 'a changed character must be rejected');
});

test('a wrong check character is reported as a likely typo', () => {
  const base = '27AAPFU0939F1Z';
  const right = gstinCheckChar(base);
  const wrong = right === 'A' ? 'B' : 'A';
  const msg = gstinProblem(base + wrong);
  assert.match(msg, /check character/i);
});

test('length and shape problems are reported distinctly', () => {
  assert.match(gstinProblem('27AAPFU'), /15 characters/);
  assert.match(gstinProblem('AAPFU0939F1Z5XX'), /doesn't look like a GSTIN/);
});

/* Unregistered customers are entirely normal in freight, so a blank GSTIN must
   never be an error — the form asks for a state code instead. */
test('a blank GSTIN is acceptable, not an error', () => {
  assert.equal(gstinProblem(''), null);
  assert.equal(gstinProblem(null), null);
  assert.equal(gstinProblem('   '), null);
});

/* The tests above generate the check character with the same function they
   validate with, so they would pass even if the algorithm were wrong. This one
   is the external anchor: a GSTIN published in GST documentation, whose check
   character was computed by someone else. */
test('matches a published GSTIN whose check character we did not compute', () => {
  assert.equal(gstinCheckChar('27AAPFU0939F1Z'), 'V');
  assert.equal(gstinProblem('27AAPFU0939F1ZV'), null);
});
