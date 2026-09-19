# Sample Dashcam Videos

This directory contains sample dashcam videos for testing the FleetWorks video streaming and event detection system.

## Quick Start

### Generate Videos with Docker

```bash
# From project root
docker build -f Dockerfile.sample-videos -t fleetworks-sample-videos .
docker run --rm -v ./assets/videos:/output fleetworks-sample-videos
```

This generates 7 sample videos (~8 MB total):
- `harsh-brake.mp4` - Critical event
- `collision.mp4` - Critical event  
- `lane-departure.mp4` - Warning event
- `speeding.mp4` - Warning event
- `harsh-turn.mp4` - Info event
- `360-forward.mp4` - 360° camera
- `cabin.mp4` - Cabin camera

### Or Use Shell Script

```bash
bash scripts/generate-sample-videos.sh ./assets/videos
```

## Video Specifications

- **Resolution:** 1280×720 (HD)
- **Codec:** H.264 (libx264)
- **Bitrate:** 1000 kbps
- **FPS:** 30
- **Duration:** 10 seconds
- **Audio:** AAC, 64 kbps
- **File Size:** ~1.2 MB each

## Using in App

### Stream via RTMP

```bash
# Start streaming server
cd streaming/
docker-compose up -d

# Stream sample video to RTMP
ffmpeg -i assets/videos/harsh-brake.mp4 \
  -c:v libx264 -preset ultrafast \
  -c:a aac \
  -f flv rtmp://localhost:1935/live/forward
```

### Direct Playback (No Streaming)

Update HTML video player:
```html
<video src="./assets/videos/harsh-brake.mp4" controls></video>
```

### Simulator

```bash
python simulators/video-event-simulator.py harsh_brake \
  --video "file://./assets/videos/harsh-brake.mp4"
```

## Testing Dashboard

1. **Generate videos** (Docker command above)
2. **Start streaming server**: `cd streaming && docker-compose up -d`
3. **Stream sample video**: `ffmpeg -i assets/videos/harsh-brake.mp4 ...` (see above)
4. **Open FleetSafe tab** in dashboard
5. **Scroll to "Live Dashcam Feeds"** section
6. Video plays at 3-5s latency with:
   - 🔴 LIVE indicator
   - Camera selector (📹 Front, 🔙 Rear, etc.)
   - Real-time status bar

## Production Use

For real dashcam footage:

```bash
# Download from Samsara API
curl -H "Authorization: Bearer $SAMSARA_API_TOKEN" \
  https://api.samsara.com/v1/vehicles/{id}/videos \
  -o samsara-video.mp4

# Or stream directly from Viofo/IP camera
ffmpeg -rtsp_transport tcp -i rtsp://camera:554/stream1 \
  -c:v libx264 -preset ultrafast \
  -f flv rtmp://localhost:1935/live/front
```

## Git Storage

Videos are committed to GitHub (small files, ~1 MB each).

To regenerate on a fresh clone:
```bash
docker build -f Dockerfile.sample-videos -t fleetworks-sample-videos .
docker run --rm -v ./assets/videos:/output fleetworks-sample-videos
```

See [SAMPLE_VIDEOS.md](../SAMPLE_VIDEOS.md) for detailed documentation.
