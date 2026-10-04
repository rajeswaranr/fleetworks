// FleetWorks — ePOD upload (Supabase Edge Function, Deno).
//
// The driver photographs the delivery proof with the phone camera and uploads it here. The
// image goes to the private device-media bucket and an `epods` row links it to a consignment
// (or carries a loose LR number for the owner to reconcile). Delivering a linked consignment
// moves it to 'delivered'.
//
// POST multipart/form-data:
//   file         the JPEG photo
//   vehicleId    uuid or ext_id
//   consignmentId?  uuid of the consignment being delivered
//   lrNo?, note?, latitude?, longitude?
// Auth — either:
//   • team login: Authorization: Bearer <driver JWT>  (membership checked)
//   • no-login WhatsApp page: ownerId + token form fields (scoped to the vehicle's org; the
//     owner must be a member — the link's token is not server-verifiable, so uploads are
//     operational proof only, reviewed by the owner)
//
// Deploy:  npx supabase functions deploy epod-upload --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOW = ["https://fleetworks.in", "https://www.fleetworks.in", "http://localhost:8642", "http://127.0.0.1:8642"];
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ALLOW.includes(o) ? o : ALLOW[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
});

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  if (!(req.headers.get("content-type") || "").startsWith("multipart/form-data")) return reply(400, { error: "Send the photo as multipart form-data." });

  let form: FormData;
  try { form = await req.formData(); } catch { return reply(400, { error: "Could not read the upload." }); }
  const file = form.get("file");
  const vehicleRef = String(form.get("vehicleId") || "");
  const consignmentId = String(form.get("consignmentId") || "");
  const lrNo = String(form.get("lrNo") || "").slice(0, 60) || null;
  const note = String(form.get("note") || "").slice(0, 200) || null;
  const ownerId = String(form.get("ownerId") || "");
  const token = String(form.get("token") || "");
  const lat = Number.isFinite(Number(form.get("latitude"))) ? Number(form.get("latitude")) : null;
  const lng = Number.isFinite(Number(form.get("longitude"))) ? Number(form.get("longitude")) : null;
  if (!(file instanceof File)) return reply(400, { error: "The photo 'file' is required." });
  if (!vehicleRef) return reply(400, { error: "vehicleId is required." });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) return reply(400, { error: "The photo is empty." });
  if (bytes.length > MAX_BYTES) return reply(413, { error: "Photo over 8 MB." });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // resolve the vehicle + org, and authorise the caller for that org
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const isUuid = /^[0-9a-f-]{36}$/i.test(vehicleRef);
  let orgIds: string[] = [];
  let driverUser: string | null = null;
  if (jwt) {
    const { data: caller } = await admin.auth.getUser(jwt);
    if (!caller?.user) return reply(401, { error: "Session expired - sign in again." });
    driverUser = caller.user.id;
    orgIds = ((await admin.from("memberships").select("org_id").eq("user_id", caller.user.id)).data || []).map((m) => m.org_id);
  } else if (/^[0-9a-f-]{36}$/i.test(ownerId) && token.length >= 6) {
    // no-login driver link: the owner must be a member; the vehicle must be in that org
    orgIds = ((await admin.from("memberships").select("org_id").eq("user_id", ownerId)).data || []).map((m) => m.org_id);
    if (!orgIds.length) return reply(403, { error: "Not allowed." });
  } else {
    return reply(401, { error: "Sign in, or open your driver link." });
  }
  if (!orgIds.length) return reply(403, { error: "You are not on any fleet." });

  const vq = admin.from("vehicles").select("id, org_id").in("org_id", orgIds);
  const { data: veh } = await (isUuid ? vq.eq("id", vehicleRef) : vq.eq("ext_id", vehicleRef)).maybeSingle();
  if (!veh) return reply(404, { error: "Vehicle not found on your fleet." });

  // verify the consignment belongs to this org before linking
  let linkCons: { id: string; status: string } | null = null;
  if (/^[0-9a-f-]{36}$/i.test(consignmentId)) {
    const { data: c } = await admin.from("consignments").select("id, status").eq("id", consignmentId).eq("org_id", veh.org_id).maybeSingle();
    linkCons = c ?? null;
  }

  const now = new Date();
  const path = `epod/${veh.org_id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await admin.storage.from("device-media").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (upErr) return reply(500, { error: "Could not store the photo: " + upErr.message });

  const { data: row, error: rowErr } = await admin.from("epods").insert({
    org_id: veh.org_id, consignment_id: linkCons?.id ?? null, vehicle_id: veh.id, lr_no: lrNo,
    storage_path: path, latitude: lat, longitude: lng, note, captured_at: now.toISOString(),
  }).select("id").single();
  if (rowErr) return reply(500, { error: rowErr.message });

  // a delivered consignment with proof moves to 'delivered' (unless already billed)
  if (linkCons && linkCons.status !== "billed" && linkCons.status !== "cancelled") {
    await admin.from("consignments").update({ status: "delivered", delivered_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", linkCons.id);
  }
  return reply(200, { ok: true, epod_id: row.id, delivered: !!linkCons });
});
