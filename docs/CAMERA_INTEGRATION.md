# Camera Integration Guide for FleetWorks Live Streaming

Complete guide to connect dashcams and 360° cameras to the FleetWorks streaming server.

## 1. Camera Types & Setup

### A. USB Dashcams (Direct Connection)

**Popular Models:**
- Viofo A119 Pro / Mini
- Thinkware X700
- Garmin Dash Cam 66W
- 70mai A500S / Omni
- Vantrue N4 (4-channel)
- Kingslim D4 (360°)

**Setup:**
1. Connect via USB to vehicle gateway (Raspberry Pi, laptop, etc.)
2. Use ffmpeg to capture video stream
3. Broadcast to Nginx RTMP server

**ffmpeg command:**
```bash
# Capture from USB camera and push to RTMP
ffmpeg -i /dev/video0 \
  -c:v libx264 -preset ultrafast -b:v 2500k \
  -c:a aac -b:a 128k \
  -f flv rtmp://server:1935/live/forward
```

**Configuration (systemd service):**
```bash
# /etc/systemd/system/camera-forward.service
[Unit]
Description=Forward Dashcam Stream
After=network.target

[Service]
Type=simple
User=fleetworks
ExecStart=/usr/bin/ffmpeg \
  -i /dev/video0 \
  -c:v libx264 -preset ultrafast -b:v 2500k \
  -c:a aac -b:a 128k \
  -f flv rtmp://localhost:1935/live/forward
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Start:
```bash
sudo systemctl enable camera-forward
sudo systemctl start camera-forward
```

---

### B. Network IP Cameras (RTSP/ONVIF)

**Popular Models:**
- Reolink RLC series
- Hikvision DS series
- Dahua IPC series
- TP-Link VIGI series
- Uniview UNV series

**Auto-discovery:**
```bash
# Scan for IP cameras on network
nmap -p 554,8554 192.168.1.0/24
nmap -p 80,443 192.168.1.0/24
```

**Get RTSP URL:**
```bash
# Common RTSP paths
rtsp://camera-ip:554/stream1
rtsp://camera-ip:554/user=admin&password=12345/stream1
rtsp://admin:password@camera-ip:554/cam/realmonitor?channel=1&subtype=1
```

**Test connection:**
```bash
# Use ffprobe to check stream
ffprobe -rtsp_transport tcp rtsp://camera-ip:554/stream1 2>&1 | grep "Duration\|Stream"
```

**Push to RTMP:**
```bash
ffmpeg -rtsp_transport tcp \
  -i rtsp://camera-ip:554/stream1 \
  -c:v libx264 -preset ultrafast -b:v 2500k \
  -c:a aac -b:a 128k \
  -f flv rtmp://server:1935/live/rear
```

**Multi-camera setup (4 cameras):**
```bash
#!/bin/bash

# Forward camera
ffmpeg -rtsp_transport tcp -i rtsp://camera1:554/stream1 \
  -c:v libx264 -preset ultrafast -b:v 2500k \
  -f flv rtmp://localhost:1935/live/forward &

# Rear camera
ffmpeg -rtsp_transport tcp -i rtsp://camera2:554/stream1 \
  -c:v libx264 -preset ultrafast -b:v 2500k \
  -f flv rtmp://localhost:1935/live/rear &

# 360 camera
ffmpeg -rtsp_transport tcp -i rtsp://camera3:554/stream1 \
  -c:v libx264 -preset ultrafast -b:v 2500k \
  -f flv rtmp://localhost:1935/live/360_forward &

# Cabin camera
ffmpeg -rtsp_transport tcp -i rtsp://camera4:554/stream1 \
  -c:v libx264 -preset ultrafast -b:v 2500k \
  -f flv rtmp://localhost:1935/live/cabin &

wait
```

---

### C. WiFi Dashcams

**Popular Models:**
- 70mai Pro (WiFi)
- Viofo A119 Mini (WiFi option)
- Kingslim WiFi models
- Papago GoSafe series

**Setup:**
1. Connect camera to vehicle WiFi hotspot
2. Get RTMP stream URL from camera's app settings
3. Relay to Nginx server

**Example (camera provides RTMP URL):**
```bash
# Camera broadcasts: rtmp://192.168.1.100:1935/live/camera
# Relay to main server:
ffmpeg -i rtmp://192.168.1.100:1935/live/camera \
  -c:v copy -c:a copy \
  -f flv rtmp://server:1935/live/forward
```

---

### D. 360° Cameras (Panoramic/Omnidirectional)

**Popular Models:**
- Insta360 X3 / X4
- Ricoh Theta X / Z1
- QooCam 8 Pro
- Kingslim 360°

**Multi-stream output:**
```bash
# 360 cameras often output 4 directional streams
# Or use special video software to extract views

# Example: Insta360 API
curl http://camera-ip:8080/live/mjpeg.m3u8
# Provides HLS stream with panoramic video

# Extract to 4 camera views:
ffmpeg -i http://camera-ip:8080/live/mjpeg.m3u8 \
  -vf "crop=iw/2:ih/2:0:0" \
  -c:v libx264 -preset ultrafast -b:v 1500k \
  -f flv rtmp://localhost:1935/live/360_forward &

ffmpeg -i http://camera-ip:8080/live/mjpeg.m3u8 \
  -vf "crop=iw/2:ih/2:iw/2:0" \
  -c:v libx264 -preset ultrafast -b:v 1500k \
  -f flv rtmp://localhost:1935/live/360_rear &

wait
```

---

### E. Smartphones as Dashcam

**Option 1: OBS Mobile App**
1. Download OBS Mobile (iOS/Android)
2. Settings → Stream → Custom RTMP Server
3. Server: rtmp://server:1935/live
4. Stream Key: forward (or rear, cabin, etc.)
5. Start streaming

**Option 2: FFmpeg on Phone (Android only)**
1. Install Termux (terminal emulator)
2. Install ffmpeg: `pkg install ffmpeg`
3. Use ffmpeg to capture camera:
```bash
ffmpeg -f android_camera -i 0 \
  -c:v libx264 -preset ultrafast \
  -f flv rtmp://server:1935/live/forward
```

---

## 2. Gateway Setup (Raspberry Pi / Vehicle PC)

### Hardware Requirements

**For 1-2 cameras:**
- Raspberry Pi 4 (4GB RAM)
- 2-camera USB hub
- 12V to USB converter
- 32GB SD card

**For 4+ cameras:**
- Raspberry Pi 5 or mini PC (Intel/AMD)
- POE switch for IP cameras
- Mobile hotspot for internet

### Raspberry Pi Setup

```bash
# Install system
sudo apt-get update
sudo apt-get install -y ffmpeg screen curl

# Create streaming user
sudo useradd -m -s /bin/bash fleetworks

# Create streaming directory
sudo mkdir -p /opt/fleetworks/streaming
sudo chown fleetworks:fleetworks /opt/fleetworks/streaming

# Copy camera scripts
sudo cp camera-*.sh /opt/fleetworks/streaming/
sudo chmod +x /opt/fleetworks/streaming/camera-*.sh

# Run as service
sudo nano /etc/systemd/system/fleetworks-streaming.service
```

**Service file:**
```ini
[Unit]
Description=FleetWorks Camera Streaming
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=fleetworks
WorkingDirectory=/opt/fleetworks/streaming
ExecStart=/opt/fleetworks/streaming/start-cameras.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Start:
```bash
sudo systemctl enable fleetworks-streaming
sudo systemctl start fleetworks-streaming
sudo journalctl -fu fleetworks-streaming
```

---

## 3. Network Configuration

### WiFi for Cameras

```bash
# Create hotspot on vehicle gateway
# Ubuntu/Linux:
nmcli device wifi hotspot ifname wlan0 ssid "FleetWorks" password "changeme123"

# Or configure with hostapd:
sudo apt-get install hostapd dnsmasq

# Edit /etc/hostapd/hostapd.conf
interface=wlan0
driver=nl80211
ssid=FleetWorks
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_key_mgmt=WPA-PSK
wpa_pairwise=CCMP
wpa_passphrase=changeme123
```

### Bandwidth Optimization

```bash
# Use traffic shaping to prioritize streams
sudo apt-get install -y tc

# Limit RTMP to 15 Mbps (4 cameras × 2.5 Mbps each + buffer)
sudo tc qdisc add dev eth0 root tbf rate 15mbit burst 32kbit latency 400ms

# Per-camera rate limiting
sudo iptables -A OUTPUT -p tcp --dport 1935 -j MARK --set-mark 1
sudo tc qdisc add dev eth0 root handle 1: prio
sudo tc qdisc add dev eth0 parent 1:1 handle 10: tbf rate 2500kbit burst 32kbit latency 400ms
```

---

## 4. Security & Authentication

### RTMP Authentication

**Nginx config (restrict who can publish):**
```nginx
application live {
    live on;
    
    # Only allow localhost or specific IPs to publish
    allow publish 127.0.0.1;
    allow publish 192.168.1.0/24;
    deny publish all;
    
    allow play all;
}
```

### RTMPS (Encrypted RTMP)

```bash
# Generate self-signed certificate
openssl req -x509 -newkey rsa:2048 -keyout server.key -out server.crt -days 365 -nodes

# Configure in nginx-rtmp.conf
rtmp {
    server {
        listen 1935;
        listen 1936 ssl;
        
        ssl_certificate /path/to/server.crt;
        ssl_certificate_key /path/to/server.key;
    }
}
```

---

## 5. Monitoring & Debugging

### Check Camera Connection

```bash
# See active RTMP connections
curl http://localhost:8080/stat | grep -i stream

# Monitor bandwidth
watch -n 1 'ifstat -i eth0'

# Check HLS file generation
ls -lah /var/www/hls/

# Monitor ffmpeg processes
ps aux | grep ffmpeg
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Camera no video | Check USB cable, device permissions, camera power |
| Slow/choppy stream | Reduce bitrate (1500k), increase buffer, check WiFi signal |
| Audio issues | Use `-c:a aac -b:a 64k` instead of high bitrate |
| High latency | Enable `lowLatencyMode`, reduce fragment size to 2s |
| Stream disconnect | Add `rtmp_hang_timeout 60s` in nginx config |

### Logs

```bash
# Nginx error log
tail -f /var/log/nginx/error.log

# ffmpeg output
ffmpeg -i /dev/video0 ... 2>&1 | tee camera.log

# Systemd service log
journalctl -fu fleetworks-streaming
```

---

## 6. Scaling to Multiple Vehicles

### Gateway per Vehicle

```
Vehicle 1: Raspberry Pi + 4 cameras → RTMP → Central Server
Vehicle 2: Raspberry Pi + 4 cameras → RTMP → Central Server
...
Vehicle 100: Raspberry Pi + 4 cameras → RTMP → Central Server
                    ↓
            Nginx RTMP (Central)
                    ↓
            HLS Playlists
                    ↓
            FleetWorks Dashboard
```

### Central Streaming Server

```bash
# VPS specifications for 100 vehicles (4 cameras each)
CPU: 8 cores
RAM: 16 GB
Network: 1 Gbps
Bandwidth: 1 Gbps (25 Mbps × 40 simultaneous streams)

# Docker setup
docker run -d \
  -p 1935:1935 \
  -p 8080:8080 \
  -v /mnt/hls:/var/www/hls \
  fleetworks-streaming:latest
```

### Load Balancing

```bash
# Use HAProxy for multiple Nginx servers
global
    maxconn 10000

frontend rtmp_in
    bind *:1935
    mode tcp
    default_backend rtmp_servers

backend rtmp_servers
    mode tcp
    balance leastconn
    server nginx1 10.0.0.1:1935
    server nginx2 10.0.0.2:1935
    server nginx3 10.0.0.3:1935
```

---

## 7. Cost Breakdown

| Component | Cost | Notes |
|-----------|------|-------|
| Dashcam (USB) | $100-500 | One-time per vehicle |
| IP Camera (Network) | $50-200 | Less reliable than USB |
| Raspberry Pi 4 | $50 | Gateway per vehicle |
| WiFi Module | $15 | For vehicle hotspot |
| Central Server (VPS) | $100/mo | For 100 vehicles |
| Bandwidth (100 vehicles) | $200-500/mo | CDN egress |
| **Total/Vehicle/Month** | **$2-5** | Plus hardware |

---

## 8. Production Checklist

- [ ] All 4 cameras streaming RTMP to server
- [ ] HLS playlists generating in /var/www/hls/
- [ ] Video player loads and plays all streams
- [ ] Camera switching works (front/rear/360/cabin)
- [ ] Latency < 5 seconds
- [ ] Network bandwidth monitoring active
- [ ] Audio working (or muted in player)
- [ ] Recording feature tested
- [ ] Gateway auto-restart on crash
- [ ] Logs configured and monitored
- [ ] CDN configured (if needed)
- [ ] Failover/redundancy tested

---

## Next Steps

1. Choose camera type (USB recommended for reliability)
2. Set up gateway (Raspberry Pi + USB hub)
3. Configure ffmpeg streaming
4. Test single camera → dashboard
5. Add 2nd, 3rd, 4th camera
6. Deploy to fleet vehicles
7. Monitor bandwidth and quality
