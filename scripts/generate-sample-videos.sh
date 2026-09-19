#!/bin/bash

# Generate Sample Videos for FleetWorks Testing
# Run in Docker: docker run --rm -v ./assets/videos:/videos jrottenberg/ffmpeg ...

OUTPUT_DIR="${1:-.}/assets/videos"
mkdir -p "$OUTPUT_DIR"

echo "🎬 Generating sample dashcam videos..."

# Harsh Brake - sudden stop
ffmpeg -f lavfi -i testsrc=size=1280x720:duration=10:rate=30 \
  -f lavfi -i sine=frequency=1000:duration=10 \
  -vf "drawtext=fontsize=60:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:text='HARSH BRAKE'" \
  -c:v libx264 -preset ultrafast -crf 28 -b:v 1000k \
  -c:a aac -b:a 64k \
  -y "$OUTPUT_DIR/harsh-brake.mp4"
echo "✓ harsh-brake.mp4 (1000 kbps, 10s)"

# Collision - impact
ffmpeg -f lavfi -i testsrc=size=1280x720:duration=10:rate=30 \
  -f lavfi -i sine=frequency=2000:duration=10 \
  -vf "drawtext=fontsize=60:fontcolor=red:x=(w-text_w)/2:y=(h-text_h)/2:text='COLLISION'" \
  -c:v libx264 -preset ultrafast -crf 28 -b:v 1000k \
  -c:a aac -b:a 64k \
  -y "$OUTPUT_DIR/collision.mp4"
echo "✓ collision.mp4 (1000 kbps, 10s)"

# Lane Departure - drift
ffmpeg -f lavfi -i testsrc=size=1280x720:duration=10:rate=30 \
  -f lavfi -i sine=frequency=800:duration=10 \
  -vf "drawtext=fontsize=60:fontcolor=yellow:x=(w-text_w)/2:y=(h-text_h)/2:text='LANE DEPARTURE'" \
  -c:v libx264 -preset ultrafast -crf 28 -b:v 1000k \
  -c:a aac -b:a 64k \
  -y "$OUTPUT_DIR/lane-departure.mp4"
echo "✓ lane-departure.mp4 (1000 kbps, 10s)"

# Speeding
ffmpeg -f lavfi -i testsrc=size=1280x720:duration=10:rate=30 \
  -f lavfi -i sine=frequency=1500:duration=10 \
  -vf "drawtext=fontsize=60:fontcolor=orange:x=(w-text_w)/2:y=(h-text_h)/2:text='SPEEDING'" \
  -c:v libx264 -preset ultrafast -crf 28 -b:v 1000k \
  -c:a aac -b:a 64k \
  -y "$OUTPUT_DIR/speeding.mp4"
echo "✓ speeding.mp4 (1000 kbps, 10s)"

# Harsh Turn
ffmpeg -f lavfi -i testsrc=size=1280x720:duration=10:rate=30 \
  -f lavfi -i sine=frequency=1200:duration=10 \
  -vf "drawtext=fontsize=60:fontcolor=cyan:x=(w-text_w)/2:y=(h-text_h)/2:text='HARSH TURN'" \
  -c:v libx264 -preset ultrafast -crf 28 -b:v 1000k \
  -c:a aac -b:a 64k \
  -y "$OUTPUT_DIR/harsh-turn.mp4"
echo "✓ harsh-turn.mp4 (1000 kbps, 10s)"

# 360 Camera view
ffmpeg -f lavfi -i testsrc=size=1280x720:duration=10:rate=30 \
  -f lavfi -i sine=frequency=1100:duration=10 \
  -vf "drawtext=fontsize=60:fontcolor=green:x=(w-text_w)/2:y=(h-text_h)/2:text='360 CAMERA'" \
  -c:v libx264 -preset ultrafast -crf 28 -b:v 1000k \
  -c:a aac -b:a 64k \
  -y "$OUTPUT_DIR/360-forward.mp4"
echo "✓ 360-forward.mp4 (1000 kbps, 10s)"

# Cabin camera view
ffmpeg -f lavfi -i testsrc=size=1280x720:duration=10:rate=30 \
  -f lavfi -i sine=frequency=900:duration=10 \
  -vf "drawtext=fontsize=60:fontcolor=blue:x=(w-text_w)/2:y=(h-text_h)/2:text='CABIN CAM'" \
  -c:v libx264 -preset ultrafast -crf 28 -b:v 1000k \
  -c:a aac -b:a 64k \
  -y "$OUTPUT_DIR/cabin.mp4"
echo "✓ cabin.mp4 (1000 kbps, 10s)"

echo ""
echo "✅ All sample videos generated!"
echo "📁 Location: $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"/*.mp4
