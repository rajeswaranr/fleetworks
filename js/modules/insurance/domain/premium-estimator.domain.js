/* ============ FleetWorks Insurance — premium estimator domain ============
   Indicative commercial-vehicle premium estimate. Deliberately arithmetic on
   published rates, NOT a language model.

   Why not AI: a premium is a table lookup plus multiplication. Asked for a
   figure, an LLM returns a confident invented number — and a customer who
   budgets on a hallucinated premium, or repeats it to a broker, has been handed
   a fabricated financial fact. Everything below is auditable: the estimate
   returns its own working so the page can show how each rupee was reached.

   What is exact vs estimated:
     THIRD PARTY  — exact. IRDAI notifies these rates and every general insurer
                    in India charges the identical figure before tax. Function
                    of gross vehicle weight alone.
     OWN DAMAGE   — a range. Base rate on IDV varies by insurer, zone and
                    vehicle age, so a single number would be false precision.

   ⚠ RATES MUST BE VERIFIED BEFORE THIS IS SHOWN TO CUSTOMERS.
   TP_RATES below carries the two slabs that could be sourced, marked
   `verified:false`. The heavier slabs are nulls on purpose rather than guesses —
   estimate() refuses to produce a TP figure for a slab it does not know, and
   the page falls back to "we'll confirm this" instead of inventing one.
   Replace this table from the current IRDAI notification and flip verified. */

"use strict";

// Goods-carrying vehicles, per-vehicle annual third-party premium, excluding GST.
// Source: secondary reporting of the IRDAI notified schedule — CONFIRM against
// the notification in force on the policy inception date before relying on it.
window.TP_RATES = {
  verified: false,
  slabs: [
    { maxGvw: 7500,   premium: 7938 },
    { maxGvw: 20000,  premium: 14330 },
    { maxGvw: 40000,  premium: null },   // ⚠ unknown — fill from the notification
    { maxGvw: Infinity, premium: null }, // ⚠ unknown — fill from the notification
  ],
};

// Own-damage base rate as a percentage of IDV. A band, because this is where
// insurers actually differ — the same truck genuinely prices differently across
// two companies on the same day.
const OD_BASE_PCT = { low: 1.05, high: 1.55 };

// Older vehicles cost more to cover per rupee insured.
function ageLoading(year) {
  if (!year) return 1;
  const age = new Date().getFullYear() - year;
  if (age <= 5) return 1;
  if (age <= 10) return 1.15;
  if (age <= 15) return 1.35;
  return 1.6;
}

// Add-ons load the OWN-DAMAGE portion only — third party is statutory and
// cannot be varied by cover choice.
const COVER_LOADING = {
  tp:     { od: false, low: 0,    high: 0    },
  imt23:  { od: true,  low: 0.10, high: 0.18 },  // lamps, tyres, bumpers, paintwork — depreciation still applies
  nildep: { od: true,  low: 0.22, high: 0.35 },  // waives the depreciation deduction at claim
};

const GST = 0.18;

/* Returns { ok, tp, odLow, odHigh, totalLow, totalHigh, working[], caveats[] }.
   Never throws and never guesses: an unknown TP slab comes back ok:false with
   the reason, so the caller shows an honest gap instead of a made-up figure. */
window.estimatePremium = function (input) {
  const { gvwKg, idv, manufactureYear, cover, ncbPercent } = input;
  const working = [], caveats = [];

  // Hard gate. Until the rate table is confirmed against the IRDAI notification
  // this returns no figure at all, rather than a figure with a caveat under it.
  // A wrong premium a customer budgets on does real damage, and a disclaimer
  // below a big rupee number is not what anyone reads. Flip TP_RATES.verified
  // once the table is checked and this lifts on its own.
  if (!window.TP_RATES.verified) {
    return {
      ok: false,
      reason: "Premium estimates switch on once we've confirmed this year's IRDAI rate schedule. Request quotes below and a licensed partner will send exact figures — usually the same working day.",
    };
  }

  // ---- Third party: exact, when the slab is known ----
  let tp = null;
  if (gvwKg) {
    const slab = window.TP_RATES.slabs.find(s => gvwKg <= s.maxGvw);
    if (slab && slab.premium != null) {
      tp = slab.premium;
      working.push({
        label: "Third-party premium",
        value: tp,
        note: "Set by IRDAI for " + (slab.maxGvw === Infinity ? "this weight class" : "GVW up to " + slab.maxGvw.toLocaleString("en-IN") + " kg") + ". Every insurer charges the same.",
      });
    }
  }
  if (tp == null) {
    return {
      ok: false,
      reason: !gvwKg
        ? "Enter the vehicle's GVW and we can calculate the third-party portion exactly."
        : "We don't hold the notified third-party rate for this weight class yet, so we won't guess at it. Request quotes and a partner will confirm.",
    };
  }

  // ---- Own damage: a range, and only if comprehensive ----
  let odLow = 0, odHigh = 0;
  const c = COVER_LOADING[cover] || COVER_LOADING.tp;
  if (c.od) {
    if (!idv) {
      caveats.push("Add your IDV and we can estimate the own-damage portion too.");
    } else {
      const age = ageLoading(manufactureYear);
      odLow  = idv * (OD_BASE_PCT.low  / 100) * age;
      odHigh = idv * (OD_BASE_PCT.high / 100) * age;
      working.push({
        label: "Own damage",
        range: [odLow, odHigh],
        note: "About " + OD_BASE_PCT.low + "–" + OD_BASE_PCT.high + "% of your ₹" + Number(idv).toLocaleString("en-IN") +
              " IDV" + (age > 1 ? ", loaded " + Math.round((age - 1) * 100) + "% for vehicle age" : "") + ".",
      });

      if (c.low > 0) {
        const aLow = odLow * c.low, aHigh = odHigh * c.high;
        odLow += aLow; odHigh += aHigh;
        working.push({
          label: cover === "nildep" ? "Nil depreciation" : "IMT-23 extension",
          range: [aLow, aHigh],
          note: cover === "nildep"
            ? "Removes the depreciation deduction when you claim."
            : "Covers lamps, tyres, mudguards, bumpers and paintwork — depreciation still applies.",
        });
      }

      const ncb = Number(ncbPercent) || 0;
      if (ncb > 0) {
        const dLow = odLow * (ncb / 100), dHigh = odHigh * (ncb / 100);
        odLow -= dLow; odHigh -= dHigh;
        working.push({
          label: "No-claim bonus (−" + ncb + "%)",
          range: [-dLow, -dHigh],
          note: "Applies to own damage only, never to third party.",
        });
      }
    }
  }

  const subLow = tp + odLow, subHigh = tp + odHigh;
  const gstLow = subLow * GST, gstHigh = subHigh * GST;
  working.push({ label: "GST @ 18%", range: [gstLow, gstHigh], note: "Charged on the whole premium." });

  if (!window.TP_RATES.verified) {
    caveats.push("Third-party rates are pending confirmation against the current IRDAI notification.");
  }
  caveats.push("Own-damage pricing varies by insurer, zone and claim history — your actual quote may fall outside this range.");

  return {
    ok: true, tp,
    odLow, odHigh,
    totalLow: subLow + gstLow,
    totalHigh: subHigh + gstHigh,
    exactOnly: !c.od,      // third-party-only is a single exact figure, not a range
    working, caveats,
  };
};
