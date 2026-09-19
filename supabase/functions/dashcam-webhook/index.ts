// Dashcam Webhook Handler
// Receives video event notifications from Samsara, Viofo, or custom dashcam systems
// Stores metadata in TimescaleDB, uploads video to S3, sends alerts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.1";
import { S3Client, PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.400.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const awsAccessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID")!;
const awsSecretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY")!;
const awsRegion = Deno.env.get("AWS_REGION") || "us-east-1";
const videoBucket = Deno.env.get("VIDEO_BUCKET") || "fleetworks-videos";

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const s3 = new S3Client({
  region: awsRegion,
  credentials: {
    accessKeyId: awsAccessKeyId,
    secretAccessKey: awsSecretAccessKey,
  },
});

interface DashcamEvent {
  vehicle_id: string;
  timestamp: string;
  event_type: string; // harsh_brake, collision, lane_departure, etc
  severity?: string;
  video_url?: string; // URL to download video from dashcam
  video_base64?: string; // Embedded video data
  latitude?: number;
  longitude?: number;
  speed_kmh?: number;
  rpm?: number;
  fuel_pct?: number;
  confidence_pct?: number;
  harsh_score?: number;
  ai_detection?: any;
  camera_position?: string;
  source?: string; // 'samsara', 'viofo', 'custom'
}

// Main webhook handler
Deno.serve(async (req) => {
  // Only POST allowed
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const event: DashcamEvent = await req.json();

    console.log(`[dashcam-webhook] Received ${event.event_type} from ${event.vehicle_id}`);

    // 1. Validate required fields
    if (!event.vehicle_id || !event.timestamp || !event.event_type) {
      return new Response("Missing required fields", { status: 400 });
    }

    // 2. Get vehicle & org context
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, org_id, driver_id, registration, latitude, longitude")
      .eq("id", event.vehicle_id)
      .single();

    if (!vehicle) {
      return new Response("Vehicle not found", { status: 404 });
    }

    // 3. Download/process video
    let s3Key: string | null = null;
    let videoUrl: string | null = null;

    if (event.video_url || event.video_base64) {
      s3Key = await uploadVideoToS3(
        event.video_base64 || event.video_url,
        vehicle.org_id,
        vehicle.id,
        event.timestamp,
        event.source || "unknown"
      );
      videoUrl = `https://${videoBucket}.s3.${awsRegion}.amazonaws.com/${s3Key}`;
    }

    // 4. Fetch current telemetry (fill gaps in event data)
    const telemetry = await getLatestTelemetry(vehicle.id);

    // 5. Insert video event into TimescaleDB
    const { data: videoEvent, error: insertError } = await supabase
      .from("video_events")
      .insert({
        org_id: vehicle.org_id,
        vehicle_id: vehicle.id,
        timestamp: new Date(event.timestamp).toISOString(),
        event_type: event.event_type,
        severity: event.severity || "info",
        s3_bucket: videoBucket,
        s3_key: s3Key,
        s3_url: videoUrl,
        latitude: event.latitude || telemetry?.latitude,
        longitude: event.longitude || telemetry?.longitude,
        speed_kmh: event.speed_kmh || telemetry?.speed_kmh,
        rpm: event.rpm || telemetry?.rpm,
        fuel_pct: event.fuel_pct || telemetry?.fuel_pct,
        confidence_pct: event.confidence_pct || 80,
        ai_detection: event.ai_detection ? JSON.stringify(event.ai_detection) : null,
        harsh_score: event.harsh_score || 0,
        status: "new",
        stream_status: s3Key ? "uploaded" : "idle",
      })
      .select()
      .single();

    if (insertError) {
      console.error("[dashcam-webhook] Insert error:", insertError);
      return new Response(`Failed to store event: ${insertError.message}`, {
        status: 500,
      });
    }

    // 6. Send alert notifications
    if (event.severity === "critical" || event.event_type === "collision") {
      await sendAlert(videoEvent, vehicle);
    }

    // 7. Log webhook receipt
    console.log(`[dashcam-webhook] Stored event ${videoEvent.id}`);

    return new Response(
      JSON.stringify({
        ok: true,
        event_id: videoEvent.id,
        video_url: videoUrl,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[dashcam-webhook] Error:", error);
    return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
  }
});

// Upload video to S3
async function uploadVideoToS3(
  videoData: string,
  orgId: string,
  vehicleId: string,
  timestamp: string,
  source: string
): Promise<string> {
  try {
    const date = new Date(timestamp);
    const key = `videos/${orgId}/${vehicleId}/${date.getTime()}_${source}.mp4`;

    let body: Uint8Array;

    if (videoData.startsWith("http")) {
      // Download from URL
      const response = await fetch(videoData);
      body = new Uint8Array(await response.arrayBuffer());
    } else {
      // Assume base64
      const binaryString = atob(videoData);
      body = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        body[i] = binaryString.charCodeAt(i);
      }
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: videoBucket,
        Key: key,
        Body: body,
        ContentType: "video/mp4",
        ServerSideEncryption: "AES256",
        Metadata: {
          org_id: orgId,
          vehicle_id: vehicleId,
          timestamp: timestamp,
          source: source,
        },
      })
    );

    console.log(`[dashcam-webhook] Uploaded video to s3://${videoBucket}/${key}`);
    return key;
  } catch (error) {
    console.error("[dashcam-webhook] S3 upload error:", error);
    throw error;
  }
}

// Get latest telemetry for a vehicle
async function getLatestTelemetry(vehicleId: string) {
  const { data } = await supabase
    .from("vehicle_telemetry")
    .select("latitude, longitude, speed_kmh, rpm, fuel_pct")
    .eq("vehicle_id", vehicleId)
    .order("time", { ascending: false })
    .limit(1)
    .single();

  return data;
}

// Send alert notifications to manager & driver
async function sendAlert(videoEvent: any, vehicle: any) {
  try {
    // 1. Get organization members with alert permission
    const { data: members } = await supabase
      .from("team_members")
      .select("user_id, role")
      .eq("org_id", vehicle.org_id)
      .in("role", ["admin", "manager"]);

    if (!members || members.length === 0) {
      return;
    }

    // 2. Send push notifications
    for (const member of members) {
      await supabase.from("video_alerts_sent").insert({
        video_event_id: videoEvent.id,
        recipient_user_id: member.user_id,
        channel: "push",
        status: "sent",
      });

      // TODO: Integrate with FCM/APNS for push notifications
    }

    // 3. Create in-app notification
    for (const member of members) {
      await supabase.from("notifications").insert({
        user_id: member.user_id,
        type: "video_alert",
        title: `${videoEvent.event_type} detected on ${vehicle.registration}`,
        body: `Speed: ${videoEvent.speed_kmh} km/h | Severity: ${videoEvent.severity}`,
        data: {
          video_event_id: videoEvent.id,
          vehicle_id: vehicle.id,
          video_url: videoEvent.s3_url,
        },
      });
    }

    console.log(`[dashcam-webhook] Alerts sent for event ${videoEvent.id}`);
  } catch (error) {
    console.error("[dashcam-webhook] Alert error:", error);
    // Don't fail the webhook if alerting fails
  }
}
