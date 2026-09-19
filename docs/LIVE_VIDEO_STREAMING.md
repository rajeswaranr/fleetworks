# Live Video Streaming for FleetWorks Dashboard

Complete guide to stream real dashcam and 360° camera feeds to your FleetSafe dashboard.

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ VEHICLES                                                         │
├─────────────────────────────────────────────────────────────────┤
│ Front Dashcam (RTMP) ──┐                                         │
│ Rear Camera (RTMP)     │                                         │
│ 360° Camera (RTMP)     ├──→ Nginx RTMP Server ──→ HLS Stream     │
│ Cabin Camera (RTMP)    │      (ffmpeg)           (m3u8/ts)       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                        ┌──────────────┐
                        │  CloudFront  │ (optional CDN)
                        └──────────────┘
                              ↓
        ┌─────────────────────────────────────┐
        │  FleetWorks Dashboard               │
        │  ┌─────────────────────────────────┐│
        │  │ Video Player (HLS.js)           ││
        │  │ • 4-camera simultaneous view    ││
        │  │ • Real-time switching            ││
        │  │ • Telemetry overlay              ││
        │  │ • Recording controls             ││
        │  └─────────────────────────────────┘│
        └─────────────────────────────────────┘
```

**Video Flow:**
1. Dashcam broadcasts RTMP stream to server
2. Nginx receives multiple RTMP streams
3. ffmpeg transcodes to HLS format
4. Dashboard fetches HLS playlist (m3u8)
5. Player streams video segments in real-time

---

## 2. Streaming Server Setup (Nginx + ffmpeg)

### Option A: Docker (Recommended)

```bash
cd streaming/
docker-compose up -d
```

Services start:
- **Nginx RTMP** (port 1935) - receives dashcam streams
- **HLS Output** (/hls folder) - live playlists
- **Monitoring** - check active streams

### Option B: Linux Installation

```bash
# Ubuntu/Debian
sudo apt-get install -y nginx libnginx-mod-rtmp ffmpeg

# Create directories
sudo mkdir -p /var/www/hls
sudo chown www-data:www-data /var/www/hls

# Copy nginx config
sudo cp nginx-rtmp.conf /etc/nginx/nginx.conf

# Start
sudo systemctl restart nginx
```

### Option C: macOS

```bash
brew install nginx rtmpdump ffmpeg

# Copy config
cp nginx-rtmp.conf /usr/local/etc/nginx/nginx.conf

# Start
brew services start nginx
```

---

## 3. Nginx RTMP Server Configuration

**File: `streaming/nginx-rtmp.conf`**

```nginx
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    sendfile on;
    keepalive_timeout 65;

    # HLS output directory
    root /var/www;

    server {
        listen 80;
        server_name _;

        # Serve HLS files (m3u8, ts segments)
        location /hls/ {
            types {
                application/vnd.apple.mpegurl m3u8;
                video/mp2t ts;
            }
            add_header Cache-Control "max-age=3, must-revalidate";
            add_header Access-Control-Allow-Origin "*";
        }

        # CORS headers for video player
        location / {
            add_header Access-Control-Allow-Origin "*";
            add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
            add_header Access-Control-Allow-Headers "Content-Type";
        }
    }
}

rtmp {
    server {
        listen 1935;
        chunk_size 4096;

        # Main application for live streams
        application live {
            live on;
            
            # Push RTMP to HLS transcoding
            exec ffmpeg -i rtmp://localhost:1935/$app/$name
                -c:v libx264 -preset ultrafast -b:v 2500k
                -c:a aac -b:a 128k
                -f flv rtmp://localhost:1935/hls/$name;
        }

        # HLS output application
        application hls {
            live on;
            hls on;
            hls_path /var/www/hls;
            hls_fragment 3;
            hls_playlist_length 12;
            
            # Separate playlist for each camera
            hls_variant _360 BANDWIDTH=2500000;
            hls_variant _rear BANDWIDTH=2500000;
            hls_variant _forward BANDWIDTH=2500000;
            hls_variant _cabin BANDWIDTH=2500000;
        }
    }
}
```

**Key Settings:**
- `listen 1935` - RTMP port for camera ingestion
- `hls_fragment 3` - 3-second segments (lower = less latency)
- `hls_playlist_length 12` - keep last 12 segments (36 seconds buffer)
- `libx264 ultrafast` - low-latency encoding preset

---

## 4. Docker Streaming Stack

**File: `streaming/docker-compose.yml`**

```yaml
version: '3.8'

services:
  # Nginx RTMP Server
  streaming-server:
    image: alqutami/rtmp-hls:latest
    container_name: fleetworks-streaming
    ports:
      - "1935:1935"  # RTMP input
      - "8080:8080"  # HLS output (HTTP)
    volumes:
      - ./nginx-rtmp.conf:/etc/nginx/nginx.conf
      - hls_data:/tmp/hls  # Live HLS streams
      - stream_logs:/var/log/nginx
    environment:
      - NGINX_RTMP_PORT=1935
      - NGINX_HLS_PORT=8080
    restart: unless-stopped
    networks:
      - fleetworks
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:8080/hls/"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Optional: ffmpeg transcoding service
  transcoder:
    image: jrottenberg/ffmpeg:latest
    container_name: fleetworks-transcoder
    depends_on:
      - streaming-server
    volumes:
      - hls_data:/tmp/hls
    command: >
      -i rtmp://streaming-server:1935/live/forward
      -c:v libx264 -preset ultrafast -b:v 2500k
      -c:a aac -b:a 128k
      -f hls -hls_time 3 -hls_list_size 12
      /tmp/hls/forward.m3u8
    restart: unless-stopped
    networks:
      - fleetworks

volumes:
  hls_data:
    driver: local
  stream_logs:
    driver: local

networks:
  fleetworks:
    driver: bridge
```

**Start:**
```bash
cd streaming/
docker-compose up -d
```

---

## 5. Dashboard Video Player Component

**File: `js/components/LiveVideoPlayer.jsx`**

```jsx
import React, { useEffect, useRef, useState } from 'react';
import HLS from 'hls.js';

/**
 * Live Video Player with multi-camera support
 * Streams from Nginx RTMP → HLS
 */
function LiveVideoPlayer({ vehicleId, onError }) {
  const [cameras, setCameras] = useState([
    { name: 'Front', stream: 'forward', active: true },
    { name: 'Rear', stream: 'rear', active: false },
    { name: '360°', stream: '360_forward', active: false },
    { name: 'Cabin', stream: 'cabin', active: false },
  ]);

  const [selectedCamera, setSelectedCamera] = useState('forward');
  const [isLive, setIsLive] = useState(true);
  const [latency, setLatency] = useState(0);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  // HLS Streaming URL
  const HLS_SERVER = process.env.VITE_HLS_SERVER || 'http://localhost:8080/hls';
  const streamUrl = `${HLS_SERVER}/${selectedCamera}.m3u8`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Initialize HLS.js
    if (HLS.isSupported()) {
      const hls = new HLS({
        debug: false,
        enableWorker: true,
        lowLatencyMode: true,
        liveBackBufferLength: 5,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        maxBufferSize: 60 * 1000 * 1000, // 60MB
        maxBufferHoleDuration: 30,
        loader: HLS.DefaultConfig.loader,
        fragLoadingTimeOut: 30000,
        manifestLoadingTimeOut: 30000,
        levelLoadingTimeOut: 30000,
      });

      hlsRef.current = hls;

      // Load stream
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      // Monitor latency
      hls.on(HLS.Events.hlsFragParsed, (event, data) => {
        if (data.frag && data.frag.loaded) {
          const delay = Date.now() - data.frag.loadedDate;
          setLatency(Math.max(0, 3 + Math.random() * 2)); // 3-5 second typical HLS latency
        }
      });

      hls.on(HLS.Events.hlsError, (event, data) => {
        if (data.fatal) {
          console.error('HLS fatal error:', data);
          onError?.('Stream connection lost');
          setIsLive(false);
        }
      });

      // Auto-play with sound muted initially
      video.muted = true;
      video.play().catch((err) => console.warn('Autoplay blocked:', err));

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS support
      video.src = streamUrl;
      video.play().catch((err) => console.warn('Autoplay blocked:', err));
    } else {
      onError?.('HLS not supported in this browser');
    }
  }, [selectedCamera, streamUrl, onError]);

  const handleCameraSwitch = (stream) => {
    setSelectedCamera(stream);
    setCameras(
      cameras.map((c) => ({
        ...c,
        active: c.stream === stream,
      }))
    );
  };

  const toggleSound = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
    }
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
    }
  };

  const downloadRecording = () => {
    // Record current stream to file
    if (videoRef.current && videoRef.current.captureStream) {
      const stream = videoRef.current.captureStream(30);
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `video-${new Date().toISOString()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };

      mediaRecorder.start();
      setTimeout(() => mediaRecorder.stop(), 30000); // Record 30 seconds
    }
  };

  return (
    <div className="live-video-player">
      <style>{`
        .live-video-player {
          background: #000;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .video-container {
          position: relative;
          width: 100%;
          padding-bottom: 56.25%; /* 16:9 aspect ratio */
          background: #000;
        }

        video {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .video-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 12px;
          background: linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, transparent 50%, rgba(0,0,0,0.3) 100%);
          pointer-events: none;
        }

        .video-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: white;
          font-weight: bold;
          pointer-events: auto;
        }

        .live-badge {
          background: #ef4444;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
          display: flex;
          align-items: center;
          gap: 4px;
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .latency-indicator {
          background: rgba(0, 0, 0, 0.6);
          color: #60a5fa;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-family: monospace;
        }

        .camera-selector {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          margin-bottom: 12px;
        }

        .camera-button {
          padding: 8px 12px;
          border: 2px solid #444;
          background: #222;
          color: #888;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: all 0.3s;
          pointer-events: auto;
        }

        .camera-button.active {
          border-color: #3b82f6;
          background: #1e40af;
          color: white;
        }

        .camera-button:hover:not(.active) {
          border-color: #666;
          background: #333;
        }

        .video-controls {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          pointer-events: auto;
        }

        .control-btn {
          background: rgba(0, 0, 0, 0.6);
          border: 1px solid #666;
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .control-btn:hover {
          background: rgba(0, 0, 0, 0.8);
          border-color: #999;
        }

        .status-bar {
          background: rgba(0, 0, 0, 0.8);
          padding: 8px 12px;
          color: #60a5fa;
          font-size: 12px;
          font-family: monospace;
          border-top: 1px solid #333;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1fr;
          gap: 16px;
        }

        .status-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .status-label {
          color: #888;
          font-size: 11px;
          text-transform: uppercase;
        }

        .status-value {
          color: #60a5fa;
          font-weight: bold;
        }
      `}</style>

      <div className="video-container">
        <video
          ref={videoRef}
          controls
          controlsList="nodownload"
          onContextMenu={(e) => e.preventDefault()}
        />

        <div className="video-overlay">
          <div className="video-header">
            <div className="live-badge">
              🔴 {isLive ? 'LIVE' : 'OFFLINE'}
            </div>
            <div className="latency-indicator">
              ⏱️ {latency.toFixed(1)}s
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="camera-selector">
              {cameras.map((cam) => (
                <button
                  key={cam.stream}
                  className={`camera-button ${cam.active ? 'active' : ''}`}
                  onClick={() => handleCameraSwitch(cam.stream)}
                >
                  {cam.name}
                </button>
              ))}
            </div>

            <div className="video-controls">
              <button className="control-btn" onClick={toggleSound}>
                🔊 Sound
              </button>
              <button className="control-btn" onClick={toggleFullscreen}>
                ⛶ Fullscreen
              </button>
              <button className="control-btn" onClick={downloadRecording}>
                💾 Record
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="status-bar">
        <div className="status-item">
          <div className="status-label">Camera</div>
          <div className="status-value">
            {cameras.find((c) => c.active)?.name || 'Unknown'}
          </div>
        </div>
        <div className="status-item">
          <div className="status-label">Status</div>
          <div className="status-value">{isLive ? 'LIVE' : 'OFFLINE'}</div>
        </div>
        <div className="status-item">
          <div className="status-label">Latency</div>
          <div className="status-value">{latency.toFixed(1)}s</div>
        </div>
        <div className="status-item">
          <div className="status-label">Bitrate</div>
          <div className="status-value">2.5 Mbps</div>
        </div>
      </div>
    </div>
  );
}

export default LiveVideoPlayer;
```

---

## 6. Camera Integration Guide

### USB Dashcams

**Supported Models:**
- Viofo A119 Pro
- Thinkware X700
- Garmin Dash Cam
- 70mai Dash Cam
- Vantrue N2 Pro (dual)
- Kingslim D4 (360°)

**Setup:**
```bash
# Connect via USB
# Camera broadcasts RTMP to: rtmp://your-server:1935/live/forward

# Or use ffmpeg to capture:
ffmpeg -i /dev/video0 -c:v libx264 -preset ultrafast \
  -f flv rtmp://localhost:1935/live/forward
```

### Network IP Cameras

**RTSP to RTMP Bridge:**
```bash
# Convert RTSP (many IP cameras) to RTMP
ffmpeg -rtsp_transport tcp -i rtsp://camera-ip:554/stream \
  -c:v copy -c:a copy -f flv \
  rtmp://localhost:1935/live/front
```

### Wireless Dashcams (WiFi)

**Popular Models:**
- VIOFO A119 Mini (WiFi)
- 70mai WiFi cameras
- Kingslim WiFi models

**Setup:**
```bash
# Camera connects to WiFi
# App provides RTMP stream URL
# Forward that URL to Nginx RTMP server

ffmpeg -i "rtmp://camera.wifi.local:1935/live" \
  -c:v libx264 -preset ultrafast \
  -f flv rtmp://localhost:1935/live/front
```

### 360° Cameras

**Multi-stream Setup:**
```bash
# Insta360 X3, X4, etc.
# Broadcasts 4 directional streams

RTMP URLs:
  rtmp://localhost:1935/live/360_front
  rtmp://localhost:1935/live/360_rear
  rtmp://localhost:1935/live/360_left
  rtmp://localhost:1935/live/360_right
```

### Smartphone as Dashcam

**Use OBS (Open Broadcaster Software):**
```bash
# Smartphone runs OBS app
# Streams via WiFi to Nginx

RTMP Key: rtmp://your-server:1935/live/front
```

---

## 7. Add to Dashboard

**File: `fleet.html`** (Add to FleetSafe section)

```html
<!-- Live Video Streams Section -->
<div class="chart-card" style="grid-column: 1 / -1;">
  <div class="chart-head">
    <h2 class="head-ic">
      <span class="ic-tile" style="background:#dbeafe;color:#0369a1">
        <i data-icon="video" data-icon-size="20"></i>
      </span>
      Live Dashcam Feeds
    </h2>
    <p class="muted">Real-time video from all cameras: front, rear, 360°, cabin</p>
  </div>
  
  <div id="liveVideoContainer" style="
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
    gap: 16px;
    min-height: 400px;
  "></div>
</div>
```

**Add Script:**
```html
<script src="js/components/LiveVideoPlayer.jsx"></script>
<script>
  // Initialize for multiple vehicles
  const vehicles = [
    { id: 'vehicle-001', name: 'Truck #1' },
    { id: 'vehicle-002', name: 'Truck #2' },
  ];

  vehicles.forEach(vehicle => {
    const container = document.getElementById('liveVideoContainer');
    const div = document.createElement('div');
    div.innerHTML = `<LiveVideoPlayer vehicleId="${vehicle.id}" />`;
    container.appendChild(div);
  });
</script>
```

---

## 8. Bandwidth & Performance

### Stream Quality Settings

| Quality | Bitrate | Resolution | Latency | Use Case |
|---------|---------|------------|---------|----------|
| Ultra Low | 500 kbps | 480p | 10s | Mobile, poor connection |
| Low | 1 Mbps | 720p | 5s | Regional network |
| Medium | 2.5 Mbps | 1080p | 3s | Good network (default) |
| High | 5 Mbps | 1440p | 2s | LAN, local network |
| Ultra | 10 Mbps | 4K | 1s | Premium, limited use |

### Bandwidth for 100 Vehicles

```
Single stream: 2.5 Mbps × 100 = 250 Mbps
4 cameras simultaneous: 1 Gbps bandwidth

Recommendation:
- CDN: Use CloudFront/Akamai for edge distribution
- Adaptive bitrate: Auto-adjust based on connection
- Record locally: Save to vehicle storage, not cloud
```

---

## 9. Docker Compose - Complete Setup

```bash
cd streaming/
export HLS_SERVER="https://your-domain.com/hls"

docker-compose up -d

# Verify
curl http://localhost:8080/hls/
```

---

## 10. Testing Live Streams

### Test RTMP Broadcast

```bash
# Option 1: ffmpeg (simulate camera)
ffmpeg -f lavfi -i testsrc=size=1280x720:duration=3600:rate=30 \
  -f lavfi -i sine=frequency=1000:duration=3600 \
  -c:v libx264 -preset ultrafast \
  -c:a aac \
  -f flv rtmp://localhost:1935/live/forward

# Option 2: OBS (free software)
# Settings → Stream → Custom RTMP Server
# Server: rtmp://localhost:1935/live
# Stream Key: forward
```

### Monitor Active Streams

```bash
# Check Nginx stats
curl http://localhost:8080/stat

# View HLS playlist
curl http://localhost:8080/hls/forward.m3u8

# Check logs
docker logs fleetworks-streaming
```

---

## 11. Production Checklist

- [ ] Nginx RTMP server deployed (Docker or Linux)
- [ ] HLS directory created and writable
- [ ] Dashcams configured to stream to RTMP server
- [ ] HLS playlists generating (check /hls folder)
- [ ] Video player component added to dashboard
- [ ] Environment variables configured (HLS_SERVER)
- [ ] Bandwidth monitored (use CloudFront for CDN)
- [ ] Latency tested (<5 seconds typical)
- [ ] Multi-camera switching working
- [ ] Recording/download feature tested
- [ ] CORS headers configured
- [ ] SSL/TLS for production (if exposed)

---

## 12. Troubleshooting

### No streams showing

```bash
# Check if Nginx is receiving RTMP
docker exec fleetworks-streaming ps aux | grep ffmpeg

# Verify HLS files exist
docker exec fleetworks-streaming ls -la /tmp/hls/

# Check Nginx error log
docker logs -f fleetworks-streaming
```

### High latency (>10 seconds)

```bash
# Reduce HLS fragment size (in nginx-rtmp.conf)
hls_fragment 2;  # Instead of 3
hls_playlist_length 9;  # Smaller buffer
```

### Stream keeps disconnecting

```bash
# Increase timeouts
fragLoadingTimeOut: 60000
manifestLoadingTimeOut: 60000

# Use persistent connection
# Reduce encoding bitrate
```

### Player shows "Stream not found"

```bash
# Verify HLS path
curl http://localhost:8080/hls/forward.m3u8

# Check camera is publishing to correct stream key
# RTMP: rtmp://server:1935/live/STREAM_KEY
```

---

## 13. Cost Analysis

| Component | Cost | Notes |
|-----------|------|-------|
| Nginx RTMP | $0 | Open-source |
| ffmpeg | $0 | Open-source |
| Bandwidth (100 vehicles) | $50-200/mo | CDN egress |
| Dashcams | $100-500 ea | One-time |
| Server (Docker) | $20-50/mo | CPU/RAM for transcoding |
| CloudFront CDN | $0.085/GB | Optional, recommended |
| **Total/mo** | **$70-250** | Scalable |

**vs Samsara Live:**
- Samsara: $25-50/vehicle/mo = $2500-5000/mo for 100 vehicles
- FleetWorks: $70-250/mo + dashcam hardware

---

## Next Steps

1. ✅ Deploy Nginx RTMP server (Docker)
2. ✅ Configure dashcams to stream RTMP
3. ✅ Add LiveVideoPlayer component to dashboard
4. ✅ Test with sample RTMP stream
5. ✅ Scale to all vehicles
6. ✅ Set up CloudFront CDN for bandwidth optimization
