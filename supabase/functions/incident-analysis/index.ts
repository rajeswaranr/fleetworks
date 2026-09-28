// FleetWorks — AI incident root-cause analysis (Supabase Edge Function, Deno).
//
// POST { source: "ai" | "device", eventId }  →  { ok, analysis }
//
// Same split as bill-review: the facts are gathered from real rows first (the
// incident, the vehicle, the driver, the readings either side of it, how often
// this has happened before, what diesel costs this fleet), and only then does
// the model see anything. Its job is to explain and recommend, never to invent a
// number. If the model is unavailable the rules write the analysis instead, so
// the owner always gets an answer.
//
// The caller's own JWT is used to read the incident, so RLS decides whether
// they may see it. Only the insert of the finished write-up uses the service role.
//
// Deploy:
//   npx supabase functions deploy incident-analysis --no-verify-jwt
//   (reuses the ANTHROPIC_API_KEY secret already set for copilot)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-opus-5";
const DEFAULT_DIESEL_RATE = 92;   // ₹/litre, used only when the fleet has no fuel bills yet

const ALLOW_ORIGINS = [
  "https://fleetworks.in", "https://www.fleetworks.in",
  "http://localhost:8642", "http://127.0.0.1:8642",
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
const err = (origin: string | null, status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: cors(origin) });

const LABEL: Record<string, string> = {
  fuel_theft: "Fuel theft", fuel_leak: "Fuel leak", tyre_pressure_loss: "Tyre pressure loss",
  tyre_low_pressure: "Low tyre pressure", engine_overheat: "Engine overheating", low_battery: "Low battery",
  forward_collision: "Forward collision warning", headway_warning: "Following too close",
  pedestrian_warning: "Pedestrian warning", lane_departure: "Lane departure", fatigue: "Driver drowsiness",
  distraction: "Driver distraction", phone_use: "Phone use while driving", no_seatbelt: "No seatbelt",
  smoking: "Smoking in cab", harsh_brake: "Harsh braking", harsh_accel: "Harsh acceleration",
  harsh_corner: "Harsh cornering", overspeed: "Overspeeding", fuel_drop: "Sudden fuel drop",
  tamper: "Device or tank tamper", power_cut: "Device power cut", sos: "SOS", panic: "Panic button",
};
const money = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

type Analysis = { root_cause: string; risk: string; action: string; compliance: string; confidence: "low" | "medium" | "high" };

// The fallback when there is no model: short, factual, built only from the facts.
function rulesAnalysis(type: string, f: Record<string, any>): Analysis {
  const veh = f.vehicle?.name || "the vehicle", repeat = f.same_type_last_30d > 0 ? ` This is the ${f.same_type_last_30d + 1}${f.same_type_last_30d === 1 ? "nd" : "th"} time in 30 days.` : "";
  const loss = f.est_loss_inr ? ` Estimated fuel value lost: ${money(f.est_loss_inr)}.` : "";
  const t: Record<string, Analysis> = {
    fuel_theft: { root_cause: `Fuel level fell while ${veh} was parked with the engine off, which a normal burn cannot explain.${repeat}`, risk: `Direct fuel loss and a possibly damaged tank cap or sender.${loss}`, action: "Call the driver now, check the tank cap and seal, and compare with the last diesel bill. If the seal is broken, file a police complaint.", compliance: "Keep the fuel curve and location as evidence for the police complaint and any insurance claim.", confidence: "medium" },
    fuel_leak: { root_cause: `Fuel dropped faster than ${veh} can burn it while driving.${repeat}`, risk: `Fire risk on hot exhaust parts and continuing fuel loss.${loss}`, action: "Ask the driver to stop safely and check under the tank and fuel lines. Book a workshop visit before the next trip.", compliance: "A fuel leak is a roadworthiness defect; do not dispatch until it is fixed.", confidence: "medium" },
    forward_collision: { root_cause: `The front camera measured a closing gap to the vehicle ahead with too little time to brake.${repeat}`, risk: "Rear-end collision, cargo damage and injury to the driver and others.", action: "Review the clip with the driver and coach on keeping a 3-second gap, more when loaded or on a downhill.", compliance: "Keep the clip; it is evidence if a claim is made later.", confidence: "medium" },
    fatigue: { root_cause: `The cabin camera saw long eye closures, a sign of drowsiness.${repeat}`, risk: "Drowsy driving is a leading cause of highway truck crashes.", action: "Call the driver and ask them to stop at the next safe place and rest for at least 20 minutes. Check their duty hours for the last 24 hours.", compliance: "Check driving hours against the Motor Transport Workers Act rest limits.", confidence: "medium" },
    phone_use: { root_cause: `The cabin camera saw a phone in the driver's hand while moving.${repeat}`, risk: "Distraction accident and a traffic fine.", action: "Coach the driver; a hands-free mount removes most of the reason to pick up the phone.", compliance: "Using a handheld phone while driving is an offence under the Motor Vehicles Act.", confidence: "medium" },
    lane_departure: { root_cause: `The front camera saw ${veh} cross the lane marking without an indicator.${repeat}`, risk: "Side-swipe or run-off-road, often an early sign of fatigue.", action: "Check for drowsiness or distraction events around the same time and coach the driver.", compliance: "", confidence: "low" },
  };
  return t[type] || {
    root_cause: `${LABEL[type] || type} detected on ${veh}.${repeat}`,
    risk: "See the evidence for details.",
    action: "Review the evidence, call the driver and decide whether a workshop visit is needed.",
    compliance: "", confidence: "low",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return err(origin, 401, "Sign in first.");

  let body: { source?: string; eventId?: string };
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }
  const source = body.source === "device" ? "device" : body.source === "ai" ? "ai" : null;
  const eventId = String(body.eventId || "");
  if (!source || !/^[0-9a-f-]{36}$/i.test(eventId)) return err(origin, 400, "source and eventId are required.");

  // Read as the caller, so RLS decides what they may see.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return err(origin, 401, "Session expired — sign in again.");

  const table = source === "ai" ? "ai_events" : "v_safety_events";
  const { data: ev, error: evErr } = await asUser.from(table).select("*").eq("id", eventId).maybeSingle();
  if (evErr) return err(origin, 500, "Could not load the incident: " + evErr.message);
  if (!ev) return err(origin, 404, "Incident not found, or you do not have access to it.");

  // ---- gather facts ----
  const at = Date.parse(ev.occurred_at);
  const iso = (ms: number) => new Date(ms).toISOString();
  const [vehRes, drvRes, telRes, histRes, fuelRes, rawRes] = await Promise.all([
    ev.vehicle_id ? asUser.from("vehicles").select("*").eq("id", ev.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    ev.driver_id ? asUser.from("drivers").select("id,name").eq("id", ev.driver_id).maybeSingle()
      : ev.vehicle_id ? asUser.from("drivers").select("id,name").eq("vehicle_id", ev.vehicle_id).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    ev.device_id ? asUser.from("telemetry")
      .select("recorded_at,speed_kmph,ignition,engine_rpm,fuel_level_pct,fuel_rate_lph,coolant_temp_c,battery_voltage,tyre_pressure_min_psi,latitude,longitude")
      .eq("device_id", ev.device_id).gte("recorded_at", iso(at - 30 * 60000)).lte("recorded_at", iso(at + 10 * 60000))
      .order("recorded_at", { ascending: true }).limit(60) : Promise.resolve({ data: [] }),
    asUser.from(table).select("id").eq("event_type", ev.event_type)
      .eq(ev.vehicle_id ? "vehicle_id" : "device_id", ev.vehicle_id || ev.device_id)
      .gte("occurred_at", iso(at - 30 * 864e5)).lt("occurred_at", ev.occurred_at).limit(50),
    asUser.from("fuel_logs").select("litres,amount").gt("litres", 0).gt("amount", 0).order("log_date", { ascending: false }).limit(60),
    source === "device" ? asUser.from("device_events").select("raw").eq("id", eventId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const vehicle = vehRes.data as Record<string, any> | null;
  const rate = median(((fuelRes.data as any[]) || []).map((r) => Number(r.amount) / Number(r.litres)).filter((x) => x > 40 && x < 200)) ?? DEFAULT_DIESEL_RATE;
  const readings = ((telRes.data as any[]) || []).map((r) => ({
    t: r.recorded_at, speed: num(r.speed_kmph), ign: r.ignition, rpm: num(r.engine_rpm), fuel_pct: num(r.fuel_level_pct),
    ect: num(r.coolant_temp_c), volts: num(r.battery_voltage), psi: num(r.tyre_pressure_min_psi),
  }));
  const evidence = (ev.evidence || (rawRes.data as any)?.raw || {}) as Record<string, any>;
  const dropPct = num(evidence.drop_pct);
  const tank = num(vehicle?.tank_capacity);
  const litresLost = dropPct !== null && tank ? +(dropPct / 100 * tank).toFixed(1) : num(evidence.litres_lost);
  const estLoss = litresLost !== null && /fuel/.test(ev.event_type) ? Math.round(litresLost * rate) : null;

  const facts = {
    incident: LABEL[ev.event_type] || ev.event_type, event_type: ev.event_type, severity: ev.severity,
    confidence: num(ev.confidence), summary: ev.summary || null, occurred_at: ev.occurred_at,
    speed_kmph: num(ev.speed_kmph), location: ev.latitude != null ? [num(ev.latitude), num(ev.longitude)] : null,
    evidence, simulated: !!ev.simulated,
    vehicle: vehicle ? { name: vehicle.name || vehicle.reg_no || vehicle.registration || null, type: vehicle.type || vehicle.vehicle_type || null, tank_litres: tank } : null,
    driver: (drvRes.data as any)?.name || null,
    same_type_last_30d: ((histRes.data as any[]) || []).length,
    diesel_rate_inr_per_l: Math.round(rate), litres_lost: litresLost, est_loss_inr: estLoss,
    readings_around_event: readings,
  };

  // ---- write-up: model if available, rules otherwise ----
  let analysis = rulesAnalysis(ev.event_type, facts);
  let model: string | null = null;

  if (ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: {
          effort: "medium",
          format: {
            type: "json_schema",
            schema: {
              type: "object", additionalProperties: false,
              required: ["root_cause", "risk", "action", "compliance", "confidence"],
              properties: {
                root_cause: { type: "string" }, risk: { type: "string" }, action: { type: "string" },
                compliance: { type: "string" }, confidence: { type: "string", enum: ["low", "medium", "high"] },
              },
            },
          },
        },
        system: `You triage incidents for an Indian commercial-vehicle fleet owner (trucks, tippers, tankers, buses). You are given the facts of one incident, computed from the fleet's own records. Write a short incident analysis the owner can act on from a phone.

- root_cause: what most likely happened and why, from the readings and evidence. 1-2 sentences.
- risk: what it puts at stake: safety, cargo, money, the vehicle. Use est_loss_inr if it is given; otherwise do not state a rupee figure.
- action: the next thing the owner should do, concretely, in order. 1-3 short sentences.
- compliance: Indian rules or evidence-keeping that apply (Motor Vehicles Act, AIS-140, rest-hour rules, police complaint or insurance claim evidence). Empty string if nothing applies.
- confidence: how well the readings support the root cause.

Use only numbers present in the facts. Money in ₹ with Indian digit grouping. Plain English, no markdown. If simulated is true, write the analysis as normal; the screen already labels it as a test.`,
        messages: [{ role: "user", content: JSON.stringify(facts) }],
      } as any);
      if ((response as any).stop_reason !== "refusal") {
        const text = (response.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("");
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.root_cause === "string" && parsed.root_cause.length > 10) {
          analysis = {
            root_cause: parsed.root_cause, risk: parsed.risk, action: parsed.action,
            compliance: parsed.compliance || "", confidence: ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "medium",
          };
          model = (response as any).model || MODEL;
        }
      }
      // Any model failure keeps the rules write-up; the owner still gets an answer.
    } catch (e) { console.error("incident-analysis model call failed:", e); }
  }

  const row = {
    org_id: ev.org_id, source, event_id: eventId, vehicle_id: ev.vehicle_id || null,
    ...analysis, est_loss_inr: estLoss, facts, model, created_by: caller.user.id,
  };
  const { data: saved, error: saveErr } = await admin.from("incident_analyses").insert(row).select().single();
  if (saveErr) return err(origin, 500, "Could not save the analysis: " + saveErr.message);
  return new Response(JSON.stringify({ ok: true, analysis: saved }), { headers: cors(origin) });
});
