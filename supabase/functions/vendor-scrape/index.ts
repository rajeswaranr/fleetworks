// FleetWorks — Vendor sourcing scrape (Supabase Edge Function, Deno).
// Holds OUTSCRAPER_API_KEY server-side; the browser NEVER sees it. The admin
// console POSTs { vendorType, city, limit } and this function calls Outscraper's
// Google Maps search, maps each place onto vendor_leads, and inserts it with
// place_id de-duplication — so the same shop is never added twice, however many
// times you scrape overlapping queries or cities.
//
// Deploy:
//   npx supabase functions deploy vendor-scrape --no-verify-jwt
//   npx supabase secrets set OUTSCRAPER_API_KEY=...
// (JWT verification is done manually inside, because the function also needs the
// service-role client for the privileged vendor_leads / scraper_runs writes.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OUTSCRAPER_API_KEY = Deno.env.get("OUTSCRAPER_API_KEY") || "";

// Outscraper's Google Maps search. Verified against the outscraper npm client
// (v2.2.2): GET, X-API-KEY header, `query` repeatable, results nested one array
// per query. async=false makes it return the data in the same response, which
// keeps this a single round trip — no polling infrastructure needed.
const OUTSCRAPER_ENDPOINT = "https://api.app.outscraper.com/maps/search-v2";

// Sync Outscraper calls get slower as the limit grows, and an edge function has
// a wall-clock budget. 100 is the ceiling; 20 is a comfortable default.
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const DEEP_LIMIT = 10;   // per locality, and a deep scan runs ~15 of them
const FETCH_TIMEOUT_MS = 110_000;

const ALLOW_ORIGINS = [
  "https://fleetworks.in",
  "https://www.fleetworks.in",
  "http://localhost:8642",
  "http://127.0.0.1:8642",
];
function cors(origin: string | null) {
  const o = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey",
    "Content-Type": "application/json",
  };
}
function err(origin: string | null, status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), { status, headers: cors(origin) });
}

// Our own taxonomy -> the phrases that actually surface these shops on Google
// Maps in India. FleetWorks is a commercial-vehicle platform, so every phrase
// has to carry an HCV word — bare "mechanic" or "auto electrician" returns car
// and two-wheeler shops, which are useless as truck-fleet partners.
//
// Several phrases per category because the same trade is listed under wildly
// different names: "lorry" is the everyday word in Tamil Nadu, workshops
// self-describe as "commercial vehicle service", and the tyre trade uses "TBR"
// (Truck-Bus-Radial) and "retreading", both of which are HCV-only by
// definition. Overlap between phrases costs nothing — results are de-duplicated
// on place_id before anything is written.
//
// Phrases marked "probed" were run against Google Maps in Chennai and confirmed
// to return that trade's own Google category; the rest follow the same pattern.
const QUERIES_FOR: Record<string, string[]> = {
  // --- running repairs ---
  mechanic: ["truck repair garage", "lorry mechanic workshop", "bus and tipper service centre"],           // probed -> Truck repair shop
  electrician: ["truck auto electrician", "lorry auto electrical works", "bus electrical repair"],
  battery: ["truck battery shop", "commercial vehicle battery dealer", "bus battery dealer"],
  tyre: ["truck tyre shop", "TBR truck bus radial tyre dealer", "truck tyre retreading"],
  puncture: ["truck puncture shop", "lorry tyre puncture repair", "highway truck tyre repair"],

  // --- systems ---
  hydraulic: ["tipper hydraulic repair", "Hyva hydraulic service", "truck hydraulic cylinder repair"],     // probed -> Hydraulic repair service
  injector: ["diesel injector pump repair truck", "Bosch diesel service", "lorry fuel injection pump repair"], // probed -> Diesel engine repair service
  radiator: ["truck radiator repair", "lorry radiator works", "bus radiator service"],                     // probed -> Radiator repair service
  spring: ["truck leaf spring works", "lorry leaf spring repair", "tipper suspension spring"],             // probed -> Auto spring shop

  // --- body trades ---
  // One category, not two: in India denting and painting is a single shop
  // ("body works"), and Google has no category for truck body building — it
  // files them under "Transportation service" or "Auto body parts supplier".
  // Expect car-shop noise here; the google_category column is how you spot it.
  bodyshop: ["lorry body works", "truck body building", "bus body builder"],
  welding: ["truck chassis welding works", "lorry welding shop", "tipper body fabrication"],               // probed -> Welder
  windshield: ["truck windshield glass replacement", "lorry windscreen fitting", "bus windshield glass"],  // probed -> Auto glass shop

  // --- supply ---
  spareparts: ["truck spare parts shop", "commercial vehicle spare parts dealer", "bus and lorry parts supplier"], // probed -> Truck parts supplier
};

// Even with truck/lorry/bus/tipper in every phrase, Google still returns car
// and two-wheeler shops — a live run for "truck repair garage in Chennai" came
// back with "Car repair and maintenance service" among the results. These
// categories are unambiguously not commercial-vehicle trades, so a result
// carrying one is dropped before it ever reaches the review queue.
//
// The list is deliberately narrow. Anything ambiguous ("Auto repair shop",
// "Mechanic", "Wheel store") is KEPT, because plenty of Indian workshops serve
// both and Google's category is only ever approximate — that grey zone is what
// the verify step in the console is for. The number dropped is reported back,
// so this never silently swallows results.
const NOT_HCV = [
  "car repair and maintenance service",
  "car dealer", "used car dealer", "car wash", "car detailing service",
  "motorcycle repair shop", "motorcycle dealer", "motor scooter repair shop",
  "motor scooter dealer", "bicycle repair shop", "bicycle store",
];
function isNotHcv(rec: { google_category?: string | null }): boolean {
  const c = (rec.google_category || "").trim().toLowerCase();
  return c !== "" && NOT_HCV.includes(c);
}

// Tamil Nadu's HCV/trucking locations — mirrors the list in admin.html so a lead
// gets the same city tag whether it arrived by scrape or by JSON upload.
//
// ORDER MATTERS: detectCity returns the first entry found in the address, so
// localities come before the metros they sit inside. An address reading
// "…, Gerugambakkam, Chennai, Tamil Nadu" should tag as Gerugambakkam — for a
// breakdown network the suburb is the useful answer, since a driver stuck there
// needs a shop nearby, not one 40km away in the city centre.
const TN_LOCALITIES = [
  // Chennai-metro localities seen in live scrapes. Extend this as more turn up.
  "Padiyanallur", "Pullilyon", "Kavanur", "Gerugambakkam", "Mowlivakkam",
  "Thiruverkadu", "Ambattur", "Avadi", "Poonamallee", "Sriperumbudur",
  "Tambaram", "Chromepet", "Guduvancheri", "Redhills", "Manali", "Ennore",
];
const TN_CITIES = [
  ...TN_LOCALITIES,
  "Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Trichy", "Salem",
  "Tirunelveli", "Erode", "Vellore", "Thoothukudi", "Tuticorin", "Dindigul", "Namakkal",
  "Karur", "Hosur", "Krishnagiri", "Thanjavur", "Nagercoil", "Cuddalore", "Kanchipuram",
];

// Which localities sit inside which metro. Used by deep scan: searching a metro
// returns Google's top-ranked (and therefore biggest, most established) shops,
// while searching each locality separately reaches into entirely different
// result sets — which is where the small independent garages actually are.
//
// This built-in map only covers Chennai. For every other Tamil Nadu district
// the admin console sends the district's own town list with the request
// (js/geo-india.js is the single source of truth for that data — duplicating
// 304 towns here would just let the two copies drift apart).
const LOCALITIES_OF: Record<string, string[]> = {
  chennai: [
    "Ambattur", "Avadi", "Poonamallee", "Redhills", "Manali", "Ennore",
    "Thiruverkadu", "Padiyanallur", "Gerugambakkam", "Tambaram", "Chromepet",
    "Guduvancheri", "Sriperumbudur", "Kavanur", "Mowlivakkam",
  ],
};

// Caller-supplied town lists are bounded hard: each extra town is a paid
// Outscraper query, and the whole run must finish inside the function's
// wall-clock budget. 15 matches the largest built-in list.
const MAX_LOCALITIES = 15;
function cleanLocalities(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    // Town names feed straight into search phrases — keep them looking like
    // town names. Parenthetical qualifiers like "Udhagamandalam (Ooty)" are fine.
    .filter((x) => x.length >= 2 && x.length <= 40 && /^[\p{L}0-9 .()'-]+$/u.test(x))
    .slice(0, MAX_LOCALITIES);
}

// City is typed by hand into the config form, so "chennai" and "Chennai" both
// arrive. Normalise, or the same city splits into two groups in the table.
function titleCase(s: string | null): string | null {
  if (!s) return null;
  return s.trim().replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) || null;
}

function detectCity(address: string, fallback: string | null): string | null {
  if (address) for (const c of TN_CITIES) if (address.toLowerCase().includes(c.toLowerCase())) return c;
  return fallback || null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Maps one Outscraper place onto our vendor_leads columns. Field names use
// fallback chains because Outscraper's schema varies a little by plan and by
// whether enrichment is on; whatever isn't mapped is still kept whole in `raw`,
// so nothing is ever lost and a mis-mapping can be corrected after the fact.
// deno-lint-ignore no-explicit-any
function mapPlace(rec: any, vendorType: string, cityFallback: string | null) {
  const address = rec.full_address ?? rec.address ?? null;
  const emails = [rec.email_1, rec.email_2, rec.email_3, rec.email].filter(Boolean);
  // Outscraper's own `city` is Google's locality string: often a pair
  // ("Chennai, Thiruverkadu") and often an outlying suburb ("Kavanur",
  // "Gerugambakkam, Mowlivakkam") rather than the metro. Neither is groupable.
  // So: canonical hub from the address first, then the city that was actually
  // searched — a shop found by "… in Chennai" belongs under Chennai however
  // Google files its locality — and only then Google's own string.
  const city = detectCity(address ?? "", null) ?? titleCase(cityFallback) ?? rec.city ?? null;
  return {
    source: "outscraper",
    service_category: vendorType,
    place_id: rec.place_id ?? rec.google_id ?? rec.cid ?? null,
    business_name: rec.name ?? rec.title ?? "Unnamed",
    google_category: rec.type ?? rec.category ?? null,
    phone: rec.phone ?? rec.phone_1 ?? null,
    website: rec.site ?? rec.website ?? null,
    address,
    city,
    latitude: num(rec.latitude),
    longitude: num(rec.longitude),
    rating: num(rec.rating),
    review_count: num(rec.reviews ?? rec.reviews_count ?? rec.review_count),
    emails: emails.length ? emails : null,
    maps_link: rec.location_link ?? rec.place_link ?? null,
    raw: rec,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");
  if (!OUTSCRAPER_API_KEY) {
    return err(origin, 503, "Scraping isn't configured yet — set the OUTSCRAPER_API_KEY secret.");
  }

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return err(origin, 401, "Sign in first.");

  let body: { vendorType?: string; city?: string; limit?: number; searchQuery?: string; configId?: string; deep?: boolean; localities?: string[] };
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }

  const vendorType = (body.vendorType || "").trim();
  const city = (body.city || "").trim();
  // hasOwn, not a truthiness check: plain property access would let inherited
  // names like "constructor" through, and the .map below would then throw.
  if (!Object.hasOwn(QUERIES_FOR, vendorType)) return err(origin, 400, "Unknown vendor type.");
  if (!city) return err(origin, 400, "City is required.");
  // The limit is per phrase, so a category's three phrases can return up to
  // 3x this before de-duplication — which is also 3x the Outscraper spend.
  let limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  // A deep scan fires ~15 queries instead of 3, so the per-query limit has to
  // come down or the whole run exceeds the edge function's time budget.
  if (body.deep) limit = Math.min(limit, DEEP_LIMIT);
  const custom = (body.searchQuery || "").trim();
  // Two shapes of run:
  //   metro (default) — every phrase for the category, against the city itself.
  //     Returns Google's top-ranked shops, which skew large and established.
  //   deep — the category's strongest phrase against each locality inside that
  //     metro. Far better at surfacing the small independent garages, because a
  //     locality search returns a different result set rather than a deeper
  //     slice of the same one.
  // Deep scan's town list: the caller's own (the admin console sends the
  // district's towns from geo-india.js), falling back to the built-in map.
  const clientLocalities = cleanLocalities(body.localities);
  const localities = body.deep
    ? (clientLocalities.length ? clientLocalities : (LOCALITIES_OF[city.toLowerCase()] ?? []))
    : [];
  const queries = custom
    ? [custom]
    : localities.length
      ? localities.map((loc) => `${QUERIES_FOR[vendorType][0]} in ${loc}`)
      : QUERIES_FOR[vendorType].map((p) => `${p} in ${city}`);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Only a FleetWorks admin may source leads — same gate as the vendor_leads
  // RLS policy. Checked against the caller's real JWT, never a client-sent flag.
  const { data: callerRes, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerRes?.user) return err(origin, 401, "Session expired — sign in again.");
  // deno-lint-ignore no-explicit-any
  const role = (callerRes.user.app_metadata as any)?.role;
  if (role !== "admin") return err(origin, 403, "Admins only.");

  // Audit row first, so a run that dies mid-flight still leaves a trace.
  const { data: run, error: runErr } = await admin
    .from("scraper_runs")
    .insert({
      config_id: body.configId || null,
      vendor_type: vendorType,
      city,
      status: "running",
      progress: `Searching Google Maps — ${queries.length} phrase${queries.length > 1 ? "s" : ""}…`,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runErr) return err(origin, 500, "Could not start the run: " + runErr.message);
  const runId = run.id as string;

  // The console polls scraper_runs while its request is in flight, so these
  // updates are what it displays. Fire-and-forget: a failed progress write must
  // never take down the scrape itself.
  const note = (progress: string) => {
    admin.from("scraper_runs").update({ progress }).eq("id", runId)
      .then(() => {}, () => {});
  };

  const fail = async (message: string, status = 502) => {
    await admin.from("scraper_runs")
      .update({ status: "failed", error_message: message.slice(0, 500), completed_at: new Date().toISOString() })
      .eq("id", runId);
    return err(origin, status, message);
  };

  try {
    const url = new URL(OUTSCRAPER_ENDPOINT);
    // `query` is repeatable — one entry per phrase, and Outscraper returns a
    // separate array of places for each.
    for (const q of queries) url.searchParams.append("query", q);
    url.searchParams.set("organizationsPerQueryLimit", String(limit));
    url.searchParams.set("language", "en");
    url.searchParams.set("region", "IN");
    url.searchParams.set("dropDuplicates", "true");
    url.searchParams.set("async", "false");

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { headers: { "X-API-KEY": OUTSCRAPER_API_KEY }, signal: ctl.signal });
    } catch (e) {
      return await fail(
        (e as Error).name === "AbortError"
          ? `Outscraper took too long. Try a smaller limit (this run asked for ${limit}).`
          : "Could not reach Outscraper: " + (e as Error).message,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 401 || res.status === 403) {
        return await fail("Outscraper rejected the API key (" + res.status + "). Check the OUTSCRAPER_API_KEY secret.");
      }
      if (res.status === 402) return await fail("Outscraper credits exhausted — top up the account.");
      return await fail(`Outscraper error ${res.status}: ${detail}`);
    }

    const payload = await res.json();
    // Sync responses nest one array of places per query, so with several phrases
    // there are several arrays to flatten. Tolerate a flat array too, in case a
    // plan returns that shape instead.
    const places: unknown[] = [];
    if (Array.isArray(payload?.data)) {
      for (const chunk of payload.data) {
        if (Array.isArray(chunk)) places.push(...chunk);
        else if (chunk && typeof chunk === "object") places.push(chunk);
      }
    }

    if (!places.length) {
      await admin.from("scraper_runs")
        .update({ status: "completed", progress: "No results", records_found: 0, records_new: 0, records_duped: 0, completed_at: new Date().toISOString() })
        .eq("id", runId);
      return new Response(
        JSON.stringify({ runId, queries, found: 0, added: 0, skipped: 0, noPlaceId: 0, leads: [], status: "completed" }),
        { headers: cors(origin) },
      );
    }

    const all = places.map((p) => mapPlace(p, vendorType, city));

    // FleetWorks partners service trucks, buses and tippers. Drop the car and
    // two-wheeler shops Google mixes in, so the review queue only ever contains
    // plausible HCV vendors.
    const mapped = all.filter((r) => !isNotHcv(r));
    const droppedLmv = all.length - mapped.length;

    // A row with no place_id can't be de-duplicated (Postgres allows many NULLs
    // in a unique column), so it would pile up a fresh copy on every scrape.
    // Drop those rather than let the table rot, and report the count honestly.
    const withId = mapped.filter((r) => r.place_id);
    const noPlaceId = mapped.length - withId.length;

    // Collapse duplicates inside this batch too — Outscraper can return the same
    // shop twice across paginated results.
    const seen = new Set<string>();
    const rows = withId.filter((r) => {
      const k = String(r.place_id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    note(`Found ${places.length} — saving…`);

    // ignoreDuplicates: place_id's unique constraint turns an already-known shop
    // into a silent no-op instead of failing the whole batch. Guard the empty
    // case — every result lacking a place_id would otherwise POST an empty body.
    let added = 0;
    // Returned to the console so it can list what actually landed, rather than
    // just quoting a number the user has to go hunting for.
    let addedLeads: unknown[] = [];
    if (rows.length) {
      const { data: inserted, error: insErr } = await admin
        .from("vendor_leads")
        .upsert(rows, { onConflict: "place_id", ignoreDuplicates: true })
        .select("id,business_name,google_category,city,phone,rating,review_count");
      if (insErr) return await fail("Could not save leads: " + insErr.message, 500);
      added = inserted?.length ?? 0;
      addedLeads = inserted ?? [];
    }
    const skipped = rows.length - added;

    await admin.from("scraper_runs")
      .update({
        status: "completed",
        progress: `Added ${added}, skipped ${skipped} already on file`,
        records_found: places.length,
        records_new: added,
        records_duped: skipped + noPlaceId,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return new Response(
      JSON.stringify({ runId, queries, found: places.length, added, skipped, noPlaceId, droppedLmv, leads: addedLeads, status: "completed" }),
      { headers: cors(origin) },
    );
  } catch (e) {
    return await fail("Unexpected error: " + (e as Error).message, 500);
  }
});
