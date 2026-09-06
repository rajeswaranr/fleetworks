/* Gradient-boosted tree scoring.

   The traversal convention is the whole risk: XGBoost sends a row to the "yes"
   child when the feature is LESS THAN split_condition, and to "no" when it is
   greater or equal. Getting that backwards does not crash — it silently
   inverts every prediction, and a fleet would act on the reversed answer.

   So the trees below are hand-built with leaf values chosen to make each path
   distinguishable, and the expected outputs are worked out by hand rather than
   by running the code being tested. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const src = readFileSync(resolve(__dirname, '../js/xgboost.js'), 'utf8');

function load() {
  const sandbox = { console, fetch: () => Promise.resolve({ ok: false }), Math, Number, Object, Array, isNaN, Date };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'xgboost.js' });
  return sandbox.fwXgb;
}

const xgb = load();

/* One split on f0 at 10:
     f0 < 10  -> leaf  +2
     f0 >= 10 -> leaf  -3
     f0 absent-> leaf  +2   (missing routes to node 1, same as yes here)      */
const tree = {
  nodeid: 0, split: 'f0', split_condition: 10, yes: 1, no: 2, missing: 1,
  children: [{ nodeid: 1, leaf: 2 }, { nodeid: 2, leaf: -3 }],
};

test('a value below the split takes the yes branch', () => {
  assert.equal(xgb._scoreTree(tree, { f0: 9.999 }), 2);
  assert.equal(xgb._scoreTree(tree, { f0: -50 }), 2);
});

test('a value at or above the split takes the no branch', () => {
  // Exactly equal must go "no" — this is the boundary that inverts silently.
  assert.equal(xgb._scoreTree(tree, { f0: 10 }), -3);
  assert.equal(xgb._scoreTree(tree, { f0: 10.001 }), -3);
});

test('an absent or NaN feature takes the missing branch', () => {
  const t = { ...tree, missing: 2 };            // route missing to the -3 leaf
  assert.equal(xgb._scoreTree(t, {}), -3);
  assert.equal(xgb._scoreTree(t, { f0: undefined }), -3);
  assert.equal(xgb._scoreTree(t, { f0: NaN }), -3);
  // ...and is genuinely distinct from the below-split path.
  assert.equal(xgb._scoreTree(t, { f0: 1 }), 2);
});

test('a malformed dump contributes nothing instead of hanging', () => {
  const broken = { nodeid: 0, split: 'f0', split_condition: 1, yes: 9, no: 9, missing: 9, children: [] };
  assert.equal(xgb._scoreTree(broken, { f0: 0 }), 0);
});

/* Two trees plus base_score. Hand-computed: base 0.5, tree A gives +2 for
   f0=1, tree B gives +1 for f1=0 (0 < 5 -> yes). Margin = 3.5. */
const twoTree = {
  base_score: 0.5,
  objective: 'reg:squarederror',
  feature_names: ['f0', 'f1'],
  min_history_rows: 0,
  trees: [
    tree,
    { nodeid: 0, split: 'f1', split_condition: 5, yes: 1, no: 2, missing: 2,
      children: [{ nodeid: 1, leaf: 1 }, { nodeid: 2, leaf: -1 }] },
  ],
};

test('margin is base_score plus every tree leaf', () => {
  assert.equal(xgb._margin(twoTree, { f0: 1, f1: 0 }), 3.5);
  assert.equal(xgb._margin(twoTree, { f0: 20, f1: 20 }), 0.5 - 3 - 1);
});

test('a regression objective returns the raw margin', () => {
  const r = xgb.predict({ f0: 1, f1: 0 }, { model: twoTree, historyRows: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.value, 3.5);
});

test('binary:logistic passes the margin through a sigmoid', () => {
  const model = { ...twoTree, objective: 'binary:logistic' };
  const r = xgb.predict({ f0: 1, f1: 0 }, { model, historyRows: 100 });
  const expected = 1 / (1 + Math.exp(-3.5));
  assert.ok(Math.abs(r.value - expected) < 1e-12);
  assert.equal(r.band, 'high');                 // 0.97
  const low = xgb.predict({ f0: 20, f1: 20 }, { model, historyRows: 100 });
  assert.equal(low.band, 'low');                // sigmoid(-3.5) = 0.029
});

/* The refusals. Each must produce a sentence, never a number, because a
   prediction the fleet cannot check is the black box we promised not to ship. */
test('with no model at all it refuses rather than guessing', () => {
  const r = xgb.predict({ f0: 1 }, { model: null, historyRows: 1000 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /hasn't been trained/i);
  assert.equal(r.value, undefined);
});

test('with too little history it refuses and says how much is needed', () => {
  const model = { ...twoTree, min_history_rows: 40 };
  const r = xgb.predict({ f0: 1, f1: 0 }, { model, historyRows: 12 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /12 service records against the 40/);
});

test('with most features missing it refuses rather than scoring the default path', () => {
  const model = { ...twoTree, feature_names: ['f0', 'f1', 'f2', 'f3'], min_history_rows: 0 };
  const r = xgb.predict({ f0: 1 }, { model, historyRows: 100 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Too little is known/);
});

test('a couple of gaps are survivable — that is what the missing branch is for', () => {
  const model = { ...twoTree, feature_names: ['f0', 'f1', 'f2'], min_history_rows: 0 };
  const r = xgb.predict({ f0: 1, f1: 0 }, { model, historyRows: 100 });
  assert.equal(r.ok, true);
});

/* The evidence. A score with nothing behind it is not shippable, so the driver
   list must name the feature that actually moved the margin. */
test('contributions name the feature that actually moved the prediction', () => {
  const model = { ...twoTree, min_history_rows: 0 };
  // f0=1 gives +2 via tree A; withholding it routes to missing (node 1, +2) —
  // so f0 shows no effect here. f1=0 gives +1; withholding routes to missing
  // (node 2, -1), an effect of +2. f1 must therefore rank first.
  const r = xgb.predict({ f0: 1, f1: 0 }, { model, historyRows: 100 });
  assert.equal(r.drivers[0].feature, 'f1');
  assert.equal(r.drivers[0].effect, 2);
  assert.equal(r.drivers[0].value, 0);
});

test('the prediction carries how much it was trained on', () => {
  const model = { ...twoTree, min_history_rows: 0, trained_rows: 412, trained_on: '2026-09-01' };
  const r = xgb.predict({ f0: 1, f1: 0 }, { model, historyRows: 100 });
  assert.equal(r.trainedRows, 412);
  assert.equal(r.trainedOn, '2026-09-01');
  assert.equal(r.trees, 2);
});
