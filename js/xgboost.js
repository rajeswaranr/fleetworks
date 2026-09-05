/* ============ FleetWorks — gradient-boosted tree scoring ============
   Runs an XGBoost model that was trained offline and exported as JSON.

   WHY IT IS SPLIT THIS WAY. XGBoost is a Python library and Supabase Edge
   Functions are Deno, so training cannot live in the product. It does not need
   to: training is a batch job run when there is new data, and a boosted tree is
   just nested if/else once it is trained. tools/train_failure_model.py fits the
   model and dumps it; this file evaluates that dump. No Python at runtime, no
   new infrastructure, and the exact model that was tested is the one that runs.

   THE GATE IS THE IMPORTANT PART. A model trained on a handful of records from
   one fleet will happily produce confident nonsense, and "No AI Black Box" is a
   promise on the landing page. So scoring REFUSES rather than guesses when the
   model is missing, when the fleet has too little history, or when the features
   a row needs are absent. A refusal an owner can read beats a number they
   cannot check — the same rule the premium estimator already follows.

   Every prediction also reports which features moved it, because a risk score
   nobody can interrogate is exactly the black box we said we would not ship. */

(function () {
  "use strict";

  // Trained artefact, loaded on demand. Null until then, and null forever if
  // there is no model — which is a valid state, not an error.
  let MODEL = null;
  let modelLoading = null;

  /* XGBoost's JSON dump. Each tree is a node:
       {nodeid, split, split_condition, yes, no, missing, children:[...]}
     or a leaf:
       {nodeid, leaf: <value>}
     The convention is: go to `yes` when the feature is LESS THAN
     split_condition, to `no` otherwise, and to `missing` when it is absent.
     Getting that comparison backwards silently inverts the model, so it is
     asserted in the tests against a tree with known outputs. */
  function scoreTree(node, features) {
    let n = node;
    // Depth-bounded so a malformed or cyclic dump cannot hang the page.
    for (let guard = 0; guard < 256; guard++) {
      if (n.leaf !== undefined) return Number(n.leaf);
      const v = features[n.split];
      const goto = (v === undefined || v === null || Number.isNaN(v))
        ? n.missing
        : (Number(v) < Number(n.split_condition) ? n.yes : n.no);
      const next = n.children && n.children.find((c) => c.nodeid === goto);
      if (!next) return 0;               // malformed dump: contribute nothing
      n = next;
    }
    return 0;
  }

  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  /* Raw margin: base_score plus every tree's leaf. Kept separate from the link
     function so a regression model and a classifier share one path. */
  function margin(model, features) {
    let m = Number(model.base_score ?? 0);
    for (const tree of model.trees) m += scoreTree(tree, features);
    return m;
  }

  /* Which features actually moved this prediction, by re-scoring with each one
     withheld. Exact for trees (unlike a global importance table), and the cost
     is one pass per feature, which at this model size is nothing.

     This is what makes the output defensible: "flagged because km since last
     service is 41,000" is checkable; "risk 0.81" is not. */
  function contributions(model, features, topN = 3) {
    const base = margin(model, features);
    const out = [];
    for (const f of model.feature_names || Object.keys(features)) {
      const without = { ...features };
      delete without[f];
      out.push({ feature: f, effect: base - margin(model, without), value: features[f] });
    }
    return out
      .filter((c) => Math.abs(c.effect) > 1e-6)
      .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
      .slice(0, topN);
  }

  /* The refusals, in the order they should be checked. Each returns a sentence
     an owner can act on rather than a boolean. */
  function refusal(model, features, historyRows) {
    if (!model) {
      return "Foresight's prediction model hasn't been trained for your fleet yet — it needs a few months of service history first.";
    }
    const need = model.min_history_rows ?? 40;
    if (historyRows != null && historyRows < need) {
      return `Not enough history to predict from yet — ${historyRows} service records against the ${need} this model needs. It stays quiet until then rather than guessing.`;
    }
    const required = model.feature_names || [];
    const missing = required.filter((f) => features[f] === undefined || features[f] === null || Number.isNaN(features[f]));
    // A couple of gaps are survivable — XGBoost has a missing branch — but if
    // most of the inputs are absent the answer is about the default path, not
    // about this vehicle.
    if (required.length && missing.length > required.length / 2) {
      return `Too little is known about this vehicle to score it — missing ${missing.slice(0, 4).join(", ")}.`;
    }
    return null;
  }

  /* The only entry point. Returns either {ok:false, reason} or a scored
     prediction carrying the evidence behind it. */
  function predict(features, opts) {
    const o = opts || {};
    const model = o.model || MODEL;
    const why = refusal(model, features, o.historyRows);
    if (why) return { ok: false, reason: why };

    const raw = margin(model, features);
    const objective = model.objective || "binary:logistic";
    const value = objective.startsWith("binary:") ? sigmoid(raw) : raw;

    return {
      ok: true,
      value,
      margin: raw,
      objective,
      // Never presented as a certainty. A model trained on one fleet's few
      // hundred rows is a hint, and the label says so.
      band: value >= 0.7 ? "high" : value >= 0.4 ? "watch" : "low",
      drivers: contributions(model, features),
      trees: model.trees.length,
      trainedOn: model.trained_on || null,
      trainedRows: model.trained_rows || null,
    };
  }

  /* Loads the exported model if the fleet has one. A 404 is the normal state
     for a fleet that has not trained yet, not a failure to report. */
  function loadModel(url) {
    if (MODEL) return Promise.resolve(MODEL);
    if (!modelLoading) {
      modelLoading = fetch(url || "models/failure-risk.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => {
          if (m && Array.isArray(m.trees)) MODEL = m;
          return MODEL;
        })
        .catch(() => null);
    }
    return modelLoading;
  }

  /* ---------- Features, computed from the fleet's own records ----------
     Deliberately the things an owner would themselves look at before deciding a
     truck is due trouble, so a prediction can be argued with. Anything unknown
     is left undefined rather than defaulted to zero: XGBoost handles a missing
     branch properly, and a fabricated zero is a lie the model will act on. */
  function featuresForVehicle(vehicleId, now) {
    const today = now ? new Date(now) : new Date();
    const days = (d) => (today - new Date(d)) / 86400000;
    const v = (window.db && db.vehicles || []).find((x) => x.id === vehicleId);
    if (!v) return {};

    const wos = (window.db && db.workOrders || []).filter((w) => w.vehicleId === vehicleId && w.completedAt);
    const issues = (window.db && db.issues || []).filter((i) => i.vehicleId === vehicleId);
    const expenses = (window.db && db.expenses || []).filter((e) => e.vehicleId === vehicleId);
    const fuel = (window.db && db.fuelLogs || []).filter((f) => f.vehicleId === vehicleId);

    const lastWo = wos.map((w) => new Date(w.completedAt)).sort((a, b) => b - a)[0];
    const spend90 = expenses
      .filter((e) => days(e.date) <= 90)
      .reduce((s, e) => s + (+e.amount || 0), 0);
    const spendPrev90 = expenses
      .filter((e) => days(e.date) > 90 && days(e.date) <= 180)
      .reduce((s, e) => s + (+e.amount || 0), 0);

    const f = {};
    if (lastWo) f.days_since_service = Math.round(days(lastWo));
    if (v.kmPerMonth) f.km_per_month = +v.kmPerMonth;
    f.open_issues = issues.filter((i) => i.status !== "Resolved").length;
    f.issues_90d = issues.filter((i) => i.reportedAt && days(i.reportedAt) <= 90).length;
    f.repairs_180d = wos.filter((w) => days(w.completedAt) <= 180).length;
    if (expenses.length) f.spend_90d = Math.round(spend90);
    // Trend, not level: a truck whose cost is climbing is the signal, and a
    // big fleet's big absolute numbers should not read as risk on their own.
    if (spendPrev90 > 0) f.spend_trend = +(spend90 / spendPrev90).toFixed(3);
    if (fuel.length >= 4) {
      const kmpl = fuel.filter((x) => +x.kmpl > 0).map((x) => +x.kmpl);
      if (kmpl.length >= 4) {
        const recent = kmpl.slice(-3).reduce((s, x) => s + x, 0) / 3;
        const all = kmpl.reduce((s, x) => s + x, 0) / kmpl.length;
        if (all > 0) f.mileage_ratio = +(recent / all).toFixed(3);
      }
    }
    return f;
  }

  // How much service history the fleet has overall, which is what the gate
  // measures — a model is only as trustworthy as the records behind it.
  function historyRowCount() {
    const wos = (window.db && db.workOrders || []).filter((w) => w.completedAt).length;
    const ex = (window.db && db.expenses || []).length;
    return wos + ex;
  }

  window.fwXgb = {
    predict, loadModel, featuresForVehicle, historyRowCount,
    // exported for the tests
    _scoreTree: scoreTree, _margin: margin, _contributions: contributions,
    _setModel: (m) => { MODEL = m; },
  };
})();
