# Video Telemetry Integration Setup

Complete guide to integrating dashcam video streaming and telemetry with FleetWorks.

## Architecture Overview

```
Dashcam Device
    ↓ RTMP/HTTP/API
Supabase Edge Function (dashcam-webhook)
    ↓
AWS S3 (Video storage)
TimescaleDB (Metadata, telemetry)
Redis (Real-time location cache)
    ↓
React Dashboard (Video viewer, alerts)
```

## 1. AWS S3 Bucket Setup

### Create S3 Bucket

```bash
# Using AWS CLI
aws s3api create-bucket \
  --bucket fleetworks-videos \
  --region us-east-1 \
  --acl private
```

### Enable Versioning (optional, for recovery)

```bash
aws s3api put-bucket-versioning \
  --bucket fleetworks-videos \
  --versioning-configuration Status=Enabled
```

### Set Lifecycle Policy (Auto-delete old videos)

```json
{
  "Rules": [
    {
      "ID": "DeleteOldVideos",
      "Status": "Enabled",
      "Prefix": "videos/",
      "Expiration": {
        "Days": 90
      }
    },
    {
      "ID": "TransitionToGlacier",
      "Status": "Enabled",
      "Prefix": "videos/",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "GLACIER"
        }
      ]
    }
  ]
}
```

Apply:
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket fleetworks-videos \
  --lifecycle-configuration file://lifecycle.json
```

### Block Public Access

```bash
aws s3api put-public-access-block \
  --bucket fleetworks-videos \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### Create IAM User for Edge Functions

```bash
# Create user
aws iam create-user --user-name fleetworks-videos

# Attach S3 policy
aws iam attach-user-policy \
  --user-name fleetworks-videos \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

# Create access key
aws iam create-access-key --user-name fleetworks-videos
```

Copy the `AccessKeyId` and `SecretAccessKey` for later.

## 2. Setup CloudFront CDN (Optional, for faster playback)

```bash
# Create distribution
aws cloudfront create-distribution \
  --origin-domain-name fleetworks-videos.s3.us-east-1.amazonaws.com \
  --default-root-object index.html
```

Configure caching:
- Default TTL: 86400 (1 day)
- Allowed methods: GET, HEAD
- Cache policy: Managed-CachingOptimized

## 3. Supabase Edge Function Deployment

### Install Dependencies

```bash
cd supabase/functions/dashcam-webhook
npm install @supabase/supabase-js @aws-sdk/client-s3
```

### Deploy Function

```bash
supabase functions deploy dashcam-webhook
```

### Set Environment Variables

In your Supabase project settings → Edge Functions → Environment Variables:

```
AWS_ACCESS_KEY_ID=<from IAM user>
AWS_SECRET_ACCESS_KEY=<from IAM user>
AWS_REGION=us-east-1
VIDEO_BUCKET=fleetworks-videos
SUPABASE_URL=<your supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

### Get Webhook URL

```bash
supabase functions list
# Output: dashcam-webhook: https://YOUR_PROJECT_ID.supabase.co/functions/v1/dashcam-webhook
```

Save this URL for dashcam configuration.

## 4. Database Migration

Apply the migration:

```bash
supabase db push
# This creates video_events, video_clips, and related tables
```

## 5. Integrate with Samsara (Recommended)

### Option A: Via Samsara Webhooks

1. **Get Webhook URL** (from Step 3 above)

2. **Configure in Samsara Dashboard**:
   - Go to Settings → Integrations → Webhooks
   - Add webhook endpoint: `https://YOUR_PROJECT_ID.supabase.co/functions/v1/dashcam-webhook`
   - Select events: `Video Events`, `Safety Events`
   - Enable video upload: Yes (sends video clips to webhook)

3. **Samsara will POST**:
```json
{
  "vehicle_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-09-13T14:30:00Z",
  "event_type": "harsh_brake",
  "severity": "warning",
  "video_url": "https://video-service-api.samsara.com/video/12345",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "speed_kmh": 65,
  "confidence_pct": 95,
  "harsh_score": 78,
  "source": "samsara"
}
```

### Option B: Via Samsara API Polling

If webhooks aren't available, poll the Samsara API every 5 minutes:

```javascript
// Edge Function alternative: supabase/functions/samsara-sync/index.ts
async function pollSamsaraEvents() {
  const response = await fetch(
    'https://api.samsara.com/v1/fleet/videos?created_after=' + lastSync,
    {
      headers: { 'Authorization': `Bearer ${SAMSARA_API_TOKEN}` }
    }
  );
  const videos = await response.json();
  
  for (const video of videos) {
    await fetch('/.../dashcam-webhook', {
      method: 'POST',
      body: JSON.stringify({
        vehicle_id: video.vehicle_id,
        timestamp: video.created_at,
        event_type: video.type,
        video_url: video.download_url,
        ...
      })
    });
  }
}
```

## 6. Integrate with Generic Dashcam (Custom RTMP)

### For standard RTMP dashcams (Viofo, Thinkware, etc.):

1. **Enable RTMP streaming on dashcam**:
   - Set RTMP server: Your IP or hostname
   - Stream key: `vehicle_<vehicle_id>`

2. **Create RTMP receiver Edge Function**:

```typescript
// supabase/functions/rtmp-receiver/index.ts
async function receiveRTMPStream(streamKey: string, videoBuffer: Uint8Array) {
  const vehicleId = streamKey.replace('vehicle_', '');
  
  // Upload to S3
  const s3Key = `videos/${vehicleId}/${Date.now()}.mp4`;
  await s3.putObject({
    Bucket: 'fleetworks-videos',
    Key: s3Key,
    Body: videoBuffer
  });
  
  // Log event
  await supabase.from('video_events').insert({
    vehicle_id: vehicleId,
    timestamp: new Date().toISOString(),
    event_type: 'continuous_recording',
    s3_key: s3Key,
    status: 'new'
  });
}
```

3. **Alternative: Use Wowza Media Server**

If you need live streaming transcoding:

```yaml
# Docker Compose for Wowza
version: '3.8'
services:
  wowza:
    image: wowzamediaserver/wowza:latest
    ports:
      - "1935:1935"
      - "8087:8087"
    environment:
      - LICENSE_KEY=your_license
    volumes:
      - ./wowza-config:/usr/local/WowzaStreamingEngine/conf
```

## 7. React Components Integration

### Add to fleet.html dashboard:

```jsx
import VideoEventsList from './js/components/VideoEventsList.jsx';
import VideoViewer from './js/components/VideoViewer.jsx';

function FleetDashboard() {
  const [selectedEvent, setSelectedEvent] = useState(null);
  
  return (
    <div>
      <VideoEventsList 
        vehicle_id={currentVehicleId}
        onSelectEvent={setSelectedEvent}
      />
      {selectedEvent && (
        <VideoViewer 
          videoEvent={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}
```

## 8. Environment Variables (.env.local)

```bash
# AWS S3
VITE_AWS_ACCESS_KEY_ID=<IAM Access Key>
VITE_AWS_SECRET_ACCESS_KEY=<IAM Secret>
VITE_AWS_REGION=us-east-1
VITE_VIDEO_BUCKET=fleetworks-videos

# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>

# Integrations
SAMSARA_API_TOKEN=<if using Samsara polling>
VIDEO_WEBHOOK_SECRET=<random secret for verification>

# CloudFront (optional)
VITE_CDN_DOMAIN=d123abc.cloudfront.net
```

## 9. Testing the Integration

### Test Webhook Locally

```bash
curl -X POST http://localhost:54321/functions/v1/dashcam-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-09-13T14:30:00Z",
    "event_type": "harsh_brake",
    "severity": "warning",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "speed_kmh": 65,
    "confidence_pct": 95,
    "harsh_score": 78,
    "source": "test"
  }'
```

### Check Database

```sql
SELECT id, vehicle_id, event_type, severity, status, created_at
FROM video_events
ORDER BY created_at DESC
LIMIT 10;
```

### Verify S3 Upload

```bash
aws s3 ls s3://fleetworks-videos/videos/ --recursive
```

## 10. Alerts & Notifications

### Push Notifications (FCM/APNS)

The webhook function stores alerts in `video_alerts_sent`. Integrate with Firebase Cloud Messaging:

```javascript
// In dashcam-webhook
if (severity === 'critical') {
  // Send FCM notification
  const message = {
    notification: {
      title: `${event_type} on ${vehicle.registration}`,
      body: `Speed: ${speed_kmh} km/h`
    },
    data: {
      video_event_id: videoEvent.id
    }
  };
  
  await admin.messaging().sendToDevice(deviceTokens, message);
}
```

### Email/SMS Alerts

```javascript
// Use Supabase Edge Functions + SendGrid/Twilio
await sendEmail({
  to: manager.email,
  subject: `Alert: Harsh Brake Detected`,
  html: `<a href="...dashboard/video/${videoEvent.id}">Review Video</a>`
});
```

## 11. Scaling Considerations

### For 100 vehicles with 10 events/day:
- S3 cost: ~$5/month
- CloudFront: ~$0.10/GB (minimal)
- Supabase: $25/month
- **Total: ~$30-35/month**

### For 1000 vehicles with 100 events/day:
- S3 cost: ~$50/month
- CloudFront: ~$1/GB (~$5-10/month)
- Add Wowza ($50+) if live streaming needed
- Consider InfluxDB Cloud for high-frequency telemetry
- **Total: ~$100-150/month**

## 12. Troubleshooting

### Videos not uploading to S3
- Check IAM permissions
- Verify AWS credentials in Edge Function env
- Check S3 bucket policy allows the user

### Webhook not receiving data
- Verify webhook URL in Samsara settings
- Check Edge Function logs: `supabase functions list`
- Test with curl (Step 9)

### Videos not playing
- Verify S3 URL is signed/public readable
- Check CloudFront cache settings
- Try direct S3 URL vs CDN

### High S3 costs
- Enable S3 Intelligent-Tiering
- Implement retention policy (default: 90 days)
- Move old videos to Glacier

## Next Steps

1. ✅ Set up S3 bucket
2. ✅ Deploy Edge Function
3. ✅ Configure Samsara webhooks (or integrate alternative dashcam)
4. ✅ Test webhook locally
5. ✅ Deploy React components
6. ✅ Set up alerts/notifications
7. ✅ Monitor costs and performance

---

**Need help?** Check the logs:
```bash
supabase functions list
supabase functions logs dashcam-webhook
```
