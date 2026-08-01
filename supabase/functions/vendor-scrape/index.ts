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
  mechanic: ["truck repair garage", "lorry mechanic workshop", "commercial vehicle service centre"],       // probed -> Truck repair shop
  electrician: ["truck auto electrician", "lorry auto electrical works", "commercial vehicle electrician"],
  battery: ["truck battery shop", "commercial vehicle battery dealer", "lorry battery dealer"],
  tyre: ["truck tyre shop", "TBR tyre dealer", "truck tyre retreading"],
  puncture: ["truck puncture shop", "lorry tyre puncture repair", "highway truck tyre repair"],

  // --- systems ---
  hydraulic: ["tipper hydraulic repair", "Hyva hydraulic service", "truck hydraulic cylinder repair"],     // probed -> Hydraulic repair service
  injector: ["diesel injector pump repair", "Bosch diesel service", "fuel injection pump repair lorry"],   // probed -> Diesel engine repair service
  radiator: ["truck radiator repair", "lorry radiator works", "radiator repair service truck"],            // probed -> Radiator repair service
  spring: ["truck leaf spring works", "lorry leaf spring repair", "auto spring shop truck"],               // probed -> Auto spring shop

  // --- body trades ---
  // One category, not two: in India denting and painting is a single shop
  // ("body works"), and Google has no category for truck body building — it
  // files them under "Transportation service" or "Auto body parts supplier".
  // Expect car-shop noise here; the google_category column is how you spot it.
  bodyshop: ["lorry body works", "truck body building works", "truck denting and painting"],
  welding: ["truck chassis welding works", "lorry welding shop", "truck body fabrication welding"],        // probed -> Welder
  windshield: ["truck windshield glass replacement", "lorry windscreen fitting", "commercial vehicle auto glass"], // probed -> Auto glass shop

  // --- supply ---
  spareparts: ["truck spare parts shop", "commercial vehicle spare parts dealer", "lorry parts supplier"], // probed -> Truck parts supplier
};

// Tamil Nadu's main HCV/trucking hubs — mirrors the list in admin.html so a lead
// gets the same city tag whether it arrived by scrape or by JSON upload.
const TN_CITIES = ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Trichy", "Salem",
  "Tirunelveli", "Erode", "Vellore", "Thoothukudi", "Tuticorin", "Dindigul", "Namakkal",
  "Karur", "Hosur", "Krishnagiri", "Thanjavur", "Nagercoil", "Cuddalore", "Kanchipuram"];

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
  // Outscraper's own `city` is Google's locality string and is often a pair,
  // e.g. "Chennai, Thiruverkadu" — unusable for filtering or grouping. Match the
  // address against our canonical hub list first and only fall back to the raw
  // value when nothing matches, so the column stays one city per row.
  const city = detectCity(address ?? "", null) ?? rec.city ?? cityFallback ?? null;
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

  let body: { vendorType?: string; city?: string; limit?: number; searchQuery?: string; configId?: string };
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }

  const vendorType = (body.vendorType || "").trim();
  const city = (body.city || "").trim();
  // hasOwn, not a truthiness check: plain property access would let inherited
  // names like "constructor" through, and the .map below would then throw.
  if (!Object.hasOwn(QUERIES_FOR, vendorType)) return err(origin, 400, "Unknown vendor type.");
  if (!city) return err(origin, 400, "City is required.");
  // The limit is per phrase, so a category's three phrases can return up to
  // 3x this before de-duplication — which is also 3x the Outscraper spend.
  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const custom = (body.searchQuery || "").trim();
  const queries = custom ? [custom] : QUERIES_FOR[vendorType].map((p) => `${p} in ${city}`);

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
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runErr) return err(origin, 500, "Could not start the run: " + runErr.message);
  const runId = run.id as string;

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
        .update({ status: "completed", records_found: 0, records_new: 0, records_duped: 0, completed_at: new Date().toISOString() })
        .eq("id", runId);
      return new Response(
        JSON.stringify({ runId, queries, found: 0, added: 0, skipped: 0, noPlaceId: 0, status: "completed" }),
        { headers: cors(origin) },
      );
    }

    const mapped = places.map((p) => mapPlace(p, vendorType, city));

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

    // ignoreDuplicates: place_id's unique constraint turns an already-known shop
    // into a silent no-op instead of failing the whole batch. Guard the empty
    // case — every result lacking a place_id would otherwise POST an empty body.
    let added = 0;
    if (rows.length) {
      const { data: inserted, error: insErr } = await admin
        .from("vendor_leads")
        .upsert(rows, { onConflict: "place_id", ignoreDuplicates: true })
        .select("id");
      if (insErr) return await fail("Could not save leads: " + insErr.message, 500);
      added = inserted?.length ?? 0;
    }
    const skipped = rows.length - added;

    await admin.from("scraper_runs")
      .update({
        status: "completed",
        records_found: places.length,
        records_new: added,
        records_duped: skipped + noPlaceId,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return new Response(
      JSON.stringify({ runId, queries, found: places.length, added, skipped, noPlaceId, status: "completed" }),
      { headers: cors(origin) },
    );
  } catch (e) {
    return await fail("Unexpected error: " + (e as Error).message, 500);
  }
});
