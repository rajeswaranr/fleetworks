#!/usr/bin/env python3
"""Train FleetWorks' Foresight failure-risk model and export it for the browser.

Run this when there is new service history; it is a batch job, not a service.
Nothing in the product depends on Python at runtime — the output is a JSON file
that js/modules/fleet-iq/xgboost.js evaluates directly, so the exact model tested here is the one
that runs, and no new infrastructure is involved.

    pip install xgboost pandas scikit-learn supabase
    export SUPABASE_URL=... SUPABASE_SERVICE_KEY=... FLEETWORKS_ORG_ID=...
    python tools/train_failure_model.py --out models/failure-risk.json

WHAT IT PREDICTS
    Whether a vehicle will need an unplanned repair in the next 30 days.
    The label comes from the fleet's own work orders: a completed job in the
    window after the feature date.

WHY THE GUARDS ARE STRICT
    Gradient boosting will fit anything, including noise. On a few months from a
    single fleet it produces confident nonsense, which is worse than silence for
    somebody deciding whether to send a truck out. So this refuses to export a
    model that has not earned its place:

      * fewer than MIN_ROWS labelled examples          -> refuse
      * fewer than MIN_POSITIVES failures to learn from -> refuse
      * cross-validated AUC no better than chance       -> refuse

    A fleet with no model gets an honest "not enough history yet" in the UI,
    which is the correct answer, not a degraded experience.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

MIN_ROWS = 200          # labelled vehicle-months before a model is worth fitting
MIN_POSITIVES = 25      # failures; below this the positive class is anecdote
MIN_AUC = 0.62          # cross-validated; 0.5 is a coin toss

FEATURES = [
    "days_since_service",
    "km_per_month",
    "open_issues",
    "issues_90d",
    "repairs_180d",
    "spend_90d",
    "spend_trend",
    "mileage_ratio",
]


def fetch(org_id):
    """Pull the raw history. Service key: this runs on a laptop, not in the app."""
    from supabase import create_client

    url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
    sb = create_client(url, key)

    def rows(table, select="*"):
        out, page = [], 0
        while True:
            r = (sb.table(table).select(select)
                 .eq("org_id", org_id).range(page * 1000, page * 1000 + 999).execute())
            out += r.data or []
            if not r.data or len(r.data) < 1000:
                return out
            page += 1

    return {
        "vehicles": rows("vehicles"),
        "work_orders": rows("work_orders"),
        "expenses": rows("expenses"),
        "issues": rows("issues"),
        "fuel_logs": rows("fuel_logs"),
    }


def build_dataset(data, horizon_days=30):
    """One row per vehicle per month, with features as of that date.

    Features must be computed from BEFORE the observation date and the label
    from after it. Mixing the two is leakage, and a model that has seen the
    future scores beautifully in testing and is useless in the cab.
    """
    import pandas as pd

    wos = pd.DataFrame(data["work_orders"])
    if wos.empty:
        return pd.DataFrame()
    wos["completed_at"] = pd.to_datetime(wos.get("completed_at"), errors="coerce", utc=True)
    ex = pd.DataFrame(data["expenses"])
    if not ex.empty:
        ex["date"] = pd.to_datetime(ex.get("date"), errors="coerce", utc=True)
    iss = pd.DataFrame(data["issues"])
    if not iss.empty:
        iss["reported_at"] = pd.to_datetime(iss.get("reported_at"), errors="coerce", utc=True)

    veh = {v["id"]: v for v in data["vehicles"]}
    start = wos["completed_at"].min()
    end = wos["completed_at"].max()
    if pd.isna(start) or pd.isna(end):
        return pd.DataFrame()

    rows = []
    for vid, v in veh.items():
        cut = start + timedelta(days=90)         # need history behind the first row
        while cut < end - timedelta(days=horizon_days):
            w = wos[(wos["vehicle_id"] == vid) & (wos["completed_at"] < cut)]
            e = ex[(ex["vehicle_id"] == vid) & (ex["date"] < cut)] if not ex.empty else ex
            i = iss[(iss["vehicle_id"] == vid) & (iss["reported_at"] < cut)] if not iss.empty else iss

            f = {"vehicle_id": vid, "as_of": cut}
            if not w.empty:
                f["days_since_service"] = (cut - w["completed_at"].max()).days
                f["repairs_180d"] = int((w["completed_at"] > cut - timedelta(days=180)).sum())
            if v.get("km_per_month"):
                f["km_per_month"] = float(v["km_per_month"])
            if not i.empty:
                f["open_issues"] = int((i.get("status") != "Resolved").sum())
                f["issues_90d"] = int((i["reported_at"] > cut - timedelta(days=90)).sum())
            if not e.empty:
                s90 = e[e["date"] > cut - timedelta(days=90)]["amount"].astype(float).sum()
                sprev = e[(e["date"] <= cut - timedelta(days=90))
                          & (e["date"] > cut - timedelta(days=180))]["amount"].astype(float).sum()
                f["spend_90d"] = float(s90)
                if sprev > 0:
                    f["spend_trend"] = float(s90 / sprev)

            future = wos[(wos["vehicle_id"] == vid)
                         & (wos["completed_at"] >= cut)
                         & (wos["completed_at"] < cut + timedelta(days=horizon_days))]
            f["label"] = int(len(future) > 0)
            rows.append(f)
            cut += timedelta(days=30)

    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="models/failure-risk.json")
    ap.add_argument("--org", default=os.environ.get("FLEETWORKS_ORG_ID"))
    ap.add_argument("--horizon", type=int, default=30)
    args = ap.parse_args()
    if not args.org:
        sys.exit("Set FLEETWORKS_ORG_ID or pass --org.")

    import numpy as np
    import xgboost as xgb
    from sklearn.model_selection import StratifiedKFold, cross_val_score

    df = build_dataset(fetch(args.org), args.horizon)
    if df.empty:
        sys.exit("No usable history — nothing to train on. This is a normal early state.")

    X = df.reindex(columns=FEATURES)          # missing columns become NaN, which XGBoost handles
    y = df["label"].astype(int)

    print(f"rows={len(df)} positives={int(y.sum())} features={list(X.columns)}")
    if len(df) < MIN_ROWS:
        sys.exit(f"Refusing to export: {len(df)} rows, need {MIN_ROWS}. "
                 "A model fitted on this would be noise wearing a confidence score.")
    if int(y.sum()) < MIN_POSITIVES:
        sys.exit(f"Refusing to export: only {int(y.sum())} failures, need {MIN_POSITIVES}.")

    model = xgb.XGBClassifier(
        n_estimators=120, max_depth=3, learning_rate=0.08,
        subsample=0.9, colsample_bytree=0.9,
        # Shallow and regularised on purpose: one fleet's history is small, and
        # depth is where boosted trees memorise rather than learn.
        reg_lambda=2.0, min_child_weight=5,
        objective="binary:logistic", eval_metric="auc",
        missing=np.nan,
    )

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=7)
    auc = float(cross_val_score(model, X, y, cv=cv, scoring="roc_auc").mean())
    print(f"cross-validated AUC = {auc:.3f}")
    if auc < MIN_AUC:
        sys.exit(f"Refusing to export: AUC {auc:.3f} is not meaningfully better than chance "
                 f"({MIN_AUC}). Foresight stays quiet rather than shipping a coin toss.")

    model.fit(X, y)
    booster = model.get_booster()
    booster.feature_names = list(X.columns)

    out = {
        "objective": "binary:logistic",
        # XGBoost's own base_score, in margin space, so the JS adds the same
        # constant the library would.
        "base_score": float(json.loads(booster.save_config())["learner"]
                            ["learner_model_param"]["base_score"]),
        "feature_names": list(X.columns),
        "min_history_rows": MIN_ROWS,
        "trained_on": datetime.now(timezone.utc).date().isoformat(),
        "trained_rows": int(len(df)),
        "cv_auc": round(auc, 3),
        "horizon_days": args.horizon,
        "trees": [json.loads(t) for t in booster.get_dump(dump_format="json")],
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    print(f"wrote {args.out}: {len(out['trees'])} trees, AUC {auc:.3f}, {len(df)} rows")


if __name__ == "__main__":
    main()
