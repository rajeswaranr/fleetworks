# Sample Videos for FleetWorks Testing

Generate or download sample dashcam videos for testing the live streaming and video events system.

## Option 1: Generate Videos with Docker (Recommended)

```bash
# Generate 7 sample videos (10 seconds each, ~6-8 MB total)
docker run --rm -v "$(pwd)/assets/videos:/videos" jrottenberg/ffmpeg \
  bash -c "cd /videos && $(cat scripts/generate-sample-videos.sh | tail -n +3)"

# Or use the script directly
bash scripts/generate-sample-videos.sh ./
```

**Output:**
```
assets/videos/
├── harsh-brake.mp4         (1 MB, CRITICAL event)
├── collision.mp4           (1 MB, CRITICAL event)
├── lane-departure.mp4      (1 MB, WARNING event)
├── speeding.mp4            (1 MB, WARNING event)
├── harsh-turn.mp4          (1 MB, INFO event)
├── 360-forward.mp4         (1 MB, 360° camera)
└── cabin.mp4               (1 MB, cabin camera)
```

## Option 2: Download Pre-recorded Videos

Using real dashcam footage (Samsara, Viofo, etc.):

```bash
# Download from Samsara API
curl -H "Authorization: Bearer $SAMSARA_API_TOKEN" \
  https://api.samsara.com/v1/videos \
  | jq '.videos[0].url' > sample-video-url.txt

# Download to local
curl -o assets/videos/samsara-sample.mp4 \
  "$(cat sample-video-url.txt)"
```

## Using Sample Videos in the App

### 1. Stream via RTMP (for live playback)

```bash
# Push to streaming server
ffmpeg -i assets/videos/harsh-brake.mp4 \
  -c:v libx264 -preset ultrafast \
  -c:a aac \
  -f flv rtmp://localhost:1935/live/forward
```

### 2. Direct playback (no streaming server)

Update `fleet.html` video player fallback:
```javascript
const fallbackUrl = './assets/videos/harsh-brake.mp4';
video.src = fallbackUrl;
video.play();
```

### 3. Dashboard simulator

Use the Python simulator with sample videos:
```bash
python simulators/video-event-simulator.py harsh_brake \
  --video "file:///path/to/assets/videos/harsh-brake.mp4"
```

## Testing Workflow

### Step 1: Generate Videos
```bash
docker run --rm -v "$(pwd)/assets/videos:/videos" jrottenberg/ffmpeg:latest \
  bash << 'EOF'
mkdir -p /videos

# Harsh Brake
ffmpeg -f lavfi -i testsrc=size=1280x720:duration=10:rate=30 \
  -f lavfi -i sine=frequency=1000:duration=10 \
  -vf "drawtext=fontsize=60:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:text='HARSH BRAKE'" \
  -c:v libx264 -preset ultrafast -crf 28 -b:v 1000k \
  -c:a aac -b:a 64k \
  -y /videos/harsh-brake.mp4

# Add other videos similarly...
EOF
```

### Step 2: Start Streaming Server
```bash
cd streaming/
docker-compose up -d
```

### Step 3: Stream Sample Video
```bash
# In vehicle/gateway:
ffmpeg -i assets/videos/harsh-brake.mp4 \
  -c:v libx264 -preset ultrafast \
  -c:a aac \
  -f flv rtmp://localhost:1935/live/forward

# Or loop continuously:
ffmpeg -stream_loop -1 -i assets/videos/harsh-brake.mp4 \
  -c:v libx264 -preset ultrafast \
  -c:a aac \
  -f flv rtmp://localhost:1935/live/forward
```

### Step 4: View in Dashboard
1. Open FleetWorks → FleetSafe
2. Scroll to **Live Dashcam Feeds**
3. Video plays with:
   - Real-time indicator (🔴 LIVE)
   - Camera selector (📹 Front / 🔙 Rear / etc.)
   - Status bar (latency, bitrate)

### Step 5: Simulate Multiple Events
```bash
# Generate 5 collision events
python simulators/video-event-simulator.py collision --count 5 --interval 3
```

## Video Specifications

### Generated Videos
- **Resolution:** 1280×720 (HD)
- **Codec:** H.264 (libx264)
- **Bitrate:** 1000 kbps (streaming)
- **FPS:** 30
- **Duration:** 10 seconds
- **Audio:** AAC, 64 kbps
- **File Size:** ~1.2 MB each
- **Total:** ~8.4 MB for 7 videos

### Streaming Quality
When pushed to RTMP/HLS:
- **Live Latency:** 3-5 seconds
- **Bandwidth:** 1 Mbps per stream
- **4 simultaneous streams:** 4 Mbps total
- **100 vehicles (25% concurrent):** 100 Mbps total

## Git Storage

### Option A: Commit to Git
Video files are small (~1 MB each), safe to commit:
```bash
git add assets/videos/*.mp4
git commit -m "Add sample dashcam videos for testing"
git push
```

### Option B: Git LFS (for larger files)
If videos >10 MB each, use Git LFS:
```bash
# Install Git LFS
brew install git-lfs  # or apt-get install git-lfs

# Track video files
git lfs track "assets/videos/*.mp4"
git add .gitattributes
git add assets/videos/*.mp4
git commit -m "Add sample videos (LFS)"
git push
```

### Option C: CDN/External Storage
For production dashcam footage:
```bash
# Upload to S3
aws s3 cp assets/videos/harsh-brake.mp4 \
  s3://fleetworks-videos/samples/harsh-brake.mp4

# Reference in app
const videoUrl = 'https://d123.cloudfront.net/samples/harsh-brake.mp4';
```

## .gitignore

Add to `.gitignore` if not committing videos:
```gitignore
# Sample videos (generated or downloaded)
assets/videos/*.mp4
assets/videos/*.m3u8
assets/videos/*.ts

# But keep the directory
!assets/videos/.gitkeep
```

## Testing Checklist

- [ ] Videos generated (7 files, ~8 MB total)
- [ ] Videos playable locally (VLC/QuickTime)
- [ ] Streaming server running (port 1935, 8080)
- [ ] Video streams to RTMP without errors
- [ ] Dashboard shows live feed
- [ ] Camera switching works (front/rear/360/cabin)
- [ ] Status indicator shows "🔴 LIVE"
- [ ] Latency display shows 3-5s
- [ ] Videos committed to GitHub

## Troubleshooting

### Video too large for GitHub
```bash
# Compress more (lower bitrate)
ffmpeg -i harsh-brake.mp4 \
  -c:v libx264 -crf 28 -b:v 500k \
  -c:a aac -b:a 32k \
  harsh-brake-compressed.mp4
```

### RTMP streaming fails
```bash
# Check Nginx is running
docker ps | grep streaming

# Check RTMP port
netstat -an | grep 1935

# Test connection
ffmpeg -i test.mp4 -c copy -f flv rtmp://localhost:1935/live/test 2>&1 | head -20
```

### HLS playlist not generating
```bash
# Check HLS directory
ls -la streaming/hls/

# Check Nginx logs
docker logs fleetworks-streaming | grep hls
```

## Next Steps

1. Generate sample videos (Docker command above)
2. Commit to `assets/videos/`
3. Update simulator to use local videos
4. Test streaming in dashboard
5. Deploy to production with real dashcams
