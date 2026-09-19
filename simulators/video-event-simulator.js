#!/usr/bin/env node

/**
 * Video Event Simulator for FleetWorks
 * Generates realistic dashcam/video events for testing
 * Posts to: dashcam-webhook Edge Function
 */

const https = require('https');

// Configuration
const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'your-anon-key',
  WEBHOOK_SECRET: process.env.VIDEO_WEBHOOK_SECRET || 'webhook-secret',
  VEHICLE_ID: process.env.VEHICLE_ID || '550e8400-e29b-41d4-a716-446655440001',
  ORG_ID: process.env.ORG_ID || '550e8400-e29b-41d4-a716-446655440000',
};

// Event types with realistic parameters
const EVENT_TYPES = {
  harsh_brake: {
    severity: 'critical',
    confidence: 85,
    harsh_score: 78,
    speed_reduction: 30,
    description: 'Sudden braking detected',
  },
  collision: {
    severity: 'critical',
    confidence: 95,
    harsh_score: 95,
    speed_reduction: 60,
    description: 'Collision impact detected',
  },
  lane_departure: {
    severity: 'warning',
    confidence: 72,
    harsh_score: 45,
    speed_reduction: 0,
    description: 'Vehicle drifted out of lane',
  },
  speeding: {
    severity: 'warning',
    confidence: 90,
    harsh_score: 30,
    speed_reduction: 0,
    description: 'Speed exceeds limit',
  },
  harsh_turn: {
    severity: 'info',
    confidence: 68,
    harsh_score: 50,
    speed_reduction: 10,
    description: 'Sharp turn detected',
  },
  harsh_acceleration: {
    severity: 'info',
    confidence: 65,
    harsh_score: 40,
    speed_reduction: 0,
    description: 'Rapid acceleration detected',
  },
};

// Camera positions for multi-camera setup
const CAMERA_POSITIONS = ['forward', 'rear', '360_forward', '360_reverse', 'cabin', 'all'];

// Sample video URLs (replace with actual S3 URLs in production)
const SAMPLE_VIDEO_URLS = {
  harsh_brake: 'https://example.s3.amazonaws.com/videos/harsh-brake-001.mp4',
  collision: 'https://example.s3.amazonaws.com/videos/collision-001.mp4',
  lane_departure: 'https://example.s3.amazonaws.com/videos/lane-departure-001.mp4',
  speeding: 'https://example.s3.amazonaws.com/videos/speeding-001.mp4',
  harsh_turn: 'https://example.s3.amazonaws.com/videos/harsh-turn-001.mp4',
};

// Sample locations in India
const LOCATIONS = [
  { name: 'Chennai - IT Corridor', lat: 13.0827, lon: 80.2707 },
  { name: 'Hyderabad - HITEC City', lat: 17.3850, lon: 78.4867 },
  { name: 'Bangalore - Whitefield', lat: 13.0355, lon: 77.6245 },
  { name: 'Delhi - Gurgaon Highway', lat: 28.4089, lon: 77.0193 },
  { name: 'Mumbai - Western Express', lat: 19.0760, lon: 72.8777 },
];

// ======= Helper Functions =======

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function getLocationNearby(lat, lon, radiusKm = 5) {
  const earthRadius = 6371;
  const latOffset = (radiusKm / earthRadius) * (180 / Math.PI);
  const lonOffset = (radiusKm / earthRadius) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);

  return {
    latitude: lat + (Math.random() - 0.5) * latOffset * 2,
    longitude: lon + (Math.random() - 0.5) * lonOffset * 2,
  };
}

// Generate realistic AI detection data
function generateAIDetection(eventType) {
  const detections = {
    harsh_brake: [
      { object: 'vehicle_ahead', confidence: 88 },
      { object: 'traffic_light', confidence: 45 },
      { object: 'pedestrian', confidence: 12 },
    ],
    collision: [
      { object: 'vehicle_ahead', confidence: 98 },
      { object: 'obstacle', confidence: 95 },
      { object: 'debris', confidence: 72 },
    ],
    lane_departure: [
      { object: 'road_marking', confidence: 92 },
      { object: 'lane_edge', confidence: 88 },
      { object: 'curb', confidence: 45 },
    ],
    speeding: [
      { object: 'speed_limit_sign', confidence: 85 },
      { object: 'school_zone', confidence: 22 },
    ],
    harsh_turn: [
      { object: 'road_curve', confidence: 78 },
      { object: 'intersection', confidence: 55 },
    ],
    harsh_acceleration: [
      { object: 'traffic_light', confidence: 65 },
      { object: 'stop_sign', confidence: 48 },
    ],
  };

  return detections[eventType] || [];
}

// ======= Event Generator =======

function generateVideoEvent(eventType) {
  const eventConfig = EVENT_TYPES[eventType];
  const location = randomElement(LOCATIONS);
  const nearbyLocation = getLocationNearby(location.lat, location.lon);

  const timestamp = new Date().toISOString();
  const speed = randomBetween(30, 100);

  return {
    vehicle_id: CONFIG.VEHICLE_ID,
    org_id: CONFIG.ORG_ID,
    timestamp,
    event_type: eventType,
    severity: eventConfig.severity,

    // Video data
    video_url: SAMPLE_VIDEO_URLS[eventType] || null,
    camera_position: randomElement(CAMERA_POSITIONS),
    duration_sec: randomBetween(5, 30),

    // Telemetry
    latitude: nearbyLocation.latitude,
    longitude: nearbyLocation.longitude,
    speed_kmh: speed,
    rpm: randomBetween(1000, 3500),
    fuel_pct: randomBetween(20, 95),

    // AI Detection
    confidence_pct: eventConfig.confidence,
    harsh_score: eventConfig.harsh_score,
    ai_detection: generateAIDetection(eventType),

    // Metadata
    source: 'simulator',
  };
}

// ======= HTTP POST Helper =======

function postEvent(event) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${CONFIG.SUPABASE_URL}/functions/v1/dashcam-webhook`);
    const payload = JSON.stringify(event);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        'X-Webhook-Secret': CONFIG.WEBHOOK_SECRET,
      },
      rejectUnauthorized: false, // For testing only
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ======= Main Simulation =======

async function simulateEvents(eventType, count = 1, intervalSec = 5) {
  console.log(`🎬 FleetWorks Video Event Simulator`);
  console.log(`📍 Event Type: ${eventType}`);
  console.log(`📊 Count: ${count}`);
  console.log(`⏱️ Interval: ${intervalSec}s`);
  console.log(`🎯 Vehicle: ${CONFIG.VEHICLE_ID}`);
  console.log(`🌐 Endpoint: ${CONFIG.SUPABASE_URL}/functions/v1/dashcam-webhook`);
  console.log('---\n');

  for (let i = 0; i < count; i++) {
    try {
      const event = generateVideoEvent(eventType);
      console.log(`[${i + 1}/${count}] Sending ${eventType} event at ${event.timestamp}`);
      console.log(`  Speed: ${event.speed_kmh} km/h | Location: ${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`);
      console.log(`  Confidence: ${event.confidence_pct}% | Harsh Score: ${event.harsh_score}`);

      const response = await postEvent(event);
      console.log(`  ✅ Response: ${response.status}`);

      if (i < count - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
    }
  }

  console.log('\n✨ Simulation complete!');
}

// ======= CLI Interface =======

const args = process.argv.slice(2);
const eventType = args[0] || 'harsh_brake';
const count = parseInt(args[1]) || 1;
const interval = parseInt(args[2]) || 5;

if (!EVENT_TYPES[eventType]) {
  console.error(`❌ Unknown event type: ${eventType}`);
  console.log('\nSupported event types:');
  Object.keys(EVENT_TYPES).forEach((type) => {
    console.log(`  - ${type}`);
  });
  process.exit(1);
}

simulateEvents(eventType, count, interval).catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
