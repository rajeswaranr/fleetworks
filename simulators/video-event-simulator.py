#!/usr/bin/env python3

"""
FleetWorks Video Event Simulator
Simulates dashcam events with video URLs (Samsara, YouTube, S3, etc.)
"""

import json
import random
import requests
import argparse
import time
from datetime import datetime
from urllib.parse import urlparse
import base64
import os
from pathlib import Path

# Configuration from environment
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://your-project.supabase.co')
SUPABASE_ANON_KEY = os.getenv('SUPABASE_ANON_KEY', 'your-anon-key')
VEHICLE_ID = os.getenv('VEHICLE_ID', '550e8400-e29b-41d4-a716-446655440001')
ORG_ID = os.getenv('ORG_ID', '550e8400-e29b-41d4-a716-446655440000')
WEBHOOK_SECRET = os.getenv('VIDEO_WEBHOOK_SECRET', 'webhook-secret')

# Event configurations
EVENT_TYPES = {
    'harsh_brake': {
        'severity': 'critical',
        'confidence': 85,
        'harsh_score': 78,
        'description': 'Sudden braking detected',
    },
    'collision': {
        'severity': 'critical',
        'confidence': 95,
        'harsh_score': 95,
        'description': 'Collision impact detected',
    },
    'lane_departure': {
        'severity': 'warning',
        'confidence': 72,
        'harsh_score': 45,
        'description': 'Vehicle drifted out of lane',
    },
    'speeding': {
        'severity': 'warning',
        'confidence': 90,
        'harsh_score': 30,
        'description': 'Speed exceeds limit',
    },
    'harsh_turn': {
        'severity': 'info',
        'confidence': 68,
        'harsh_score': 50,
        'description': 'Sharp turn detected',
    },
    'harsh_acceleration': {
        'severity': 'info',
        'confidence': 65,
        'harsh_score': 40,
        'description': 'Rapid acceleration detected',
    },
}

CAMERA_POSITIONS = ['forward', 'rear', '360_forward', '360_reverse', 'cabin', 'all']

# Sample video URLs (real sources)
VIDEO_SOURCES = {
    'harsh_brake': [
        'https://example.com/videos/harsh-brake-1.mp4',
        's3://fleetworks-videos/demos/harsh-brake.mp4',
    ],
    'collision': [
        'https://example.com/videos/collision-1.mp4',
        's3://fleetworks-videos/demos/collision.mp4',
    ],
    'lane_departure': [
        'https://example.com/videos/lane-departure-1.mp4',
    ],
    'speeding': [
        'https://example.com/videos/speeding-1.mp4',
    ],
    'harsh_turn': [
        'https://example.com/videos/harsh-turn-1.mp4',
    ],
}

# India locations for realistic testing
LOCATIONS = [
    {'name': 'Chennai - IT Corridor', 'lat': 13.0827, 'lon': 80.2707},
    {'name': 'Hyderabad - HITEC City', 'lat': 17.3850, 'lon': 78.4867},
    {'name': 'Bangalore - Whitefield', 'lat': 13.0355, 'lon': 77.6245},
    {'name': 'Delhi - Gurgaon Highway', 'lat': 28.4089, 'lon': 77.0193},
    {'name': 'Mumbai - Western Express', 'lat': 19.0760, 'lon': 72.8777},
]


def random_between(min_val, max_val):
    """Generate random integer between min and max."""
    return random.randint(min_val, max_val)


def get_location_nearby(lat, lon, radius_km=5):
    """Get a random location within radius."""
    earth_radius = 6371
    lat_offset = (radius_km / earth_radius) * (180 / 3.14159)
    lon_offset = (radius_km / earth_radius) * (180 / 3.14159) / abs(
        3.14159 * lat / 180
    )

    return {
        'latitude': lat + (random.random() - 0.5) * lat_offset * 2,
        'longitude': lon + (random.random() - 0.5) * lon_offset * 2,
    }


def generate_ai_detection(event_type):
    """Generate realistic AI detection data."""
    detections = {
        'harsh_brake': [
            {'object': 'vehicle_ahead', 'confidence': 88},
            {'object': 'traffic_light', 'confidence': 45},
            {'object': 'pedestrian', 'confidence': 12},
        ],
        'collision': [
            {'object': 'vehicle_ahead', 'confidence': 98},
            {'object': 'obstacle', 'confidence': 95},
            {'object': 'debris', 'confidence': 72},
        ],
        'lane_departure': [
            {'object': 'road_marking', 'confidence': 92},
            {'object': 'lane_edge', 'confidence': 88},
            {'object': 'curb', 'confidence': 45},
        ],
        'speeding': [
            {'object': 'speed_limit_sign', 'confidence': 85},
            {'object': 'school_zone', 'confidence': 22},
        ],
        'harsh_turn': [
            {'object': 'road_curve', 'confidence': 78},
            {'object': 'intersection', 'confidence': 55},
        ],
        'harsh_acceleration': [
            {'object': 'traffic_light', 'confidence': 65},
            {'object': 'stop_sign', 'confidence': 48},
        ],
    }
    return detections.get(event_type, [])


def generate_video_event(event_type, video_url=None):
    """Generate a realistic video event."""
    event_config = EVENT_TYPES[event_type]
    location = random.choice(LOCATIONS)
    nearby = get_location_nearby(location['lat'], location['lon'])
    speed = random_between(30, 100)

    # Use provided video URL or pick random from available sources
    if not video_url:
        video_url = random.choice(VIDEO_SOURCES.get(event_type, ['']))

    return {
        'vehicle_id': VEHICLE_ID,
        'org_id': ORG_ID,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'event_type': event_type,
        'severity': event_config['severity'],

        # Video data
        'video_url': video_url,
        'camera_position': random.choice(CAMERA_POSITIONS),
        'duration_sec': random_between(5, 30),
        'file_size_mb': random_between(15, 150),

        # Telemetry
        'latitude': nearby['latitude'],
        'longitude': nearby['longitude'],
        'speed_kmh': speed,
        'rpm': random_between(1000, 3500),
        'fuel_pct': random_between(20, 95),

        # AI Detection
        'confidence_pct': event_config['confidence'],
        'harsh_score': event_config['harsh_score'],
        'ai_detection': generate_ai_detection(event_type),

        # Metadata
        'source': 'simulator',
    }


def post_event(event, verbose=False):
    """POST event to dashcam-webhook."""
    url = f'{SUPABASE_URL}/functions/v1/dashcam-webhook'
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
        'X-Webhook-Secret': WEBHOOK_SECRET,
    }

    try:
        response = requests.post(url, json=event, headers=headers, timeout=10)

        if response.status_code in (200, 201):
            if verbose:
                print(f"✅ Status: {response.status_code}")
                print(f"Response: {response.text[:200]}")
            return True
        else:
            print(f"❌ Status: {response.status_code}")
            print(f"Error: {response.text}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Connection error: {e}")
        return False


def simulate_events(event_type, count=1, interval=5, video_url=None, verbose=False):
    """Simulate multiple video events."""
    print(f"\n🎬 FleetWorks Video Event Simulator")
    print(f"📍 Event Type: {event_type}")
    print(f"📊 Count: {count}")
    print(f"⏱️  Interval: {interval}s")
    print(f"🎯 Vehicle: {VEHICLE_ID}")
    print(f"🌐 Endpoint: {SUPABASE_URL}/functions/v1/dashcam-webhook")
    if video_url:
        print(f"🎥 Video URL: {video_url}")
    print("---\n")

    for i in range(count):
        try:
            event = generate_video_event(event_type, video_url)
            print(f"[{i+1}/{count}] Sending {event_type} event")
            print(f"  📅 Time: {event['timestamp']}")
            print(f"  📍 Location: {event['latitude']:.4f}, {event['longitude']:.4f}")
            print(f"  🚗 Speed: {event['speed_kmh']} km/h | RPM: {event['rpm']}")
            print(f"  🎥 Camera: {event['camera_position']} | Duration: {event['duration_sec']}s")
            print(f"  📊 Confidence: {event['confidence_pct']}% | Harsh Score: {event['harsh_score']}")

            if post_event(event, verbose):
                print(f"  ✅ Posted successfully")
            else:
                print(f"  ⚠️  Failed to post")

            if i < count - 1:
                time.sleep(interval)

        except Exception as e:
            print(f"  ❌ Error: {e}")

    print(f"\n✨ Simulation complete!")


def main():
    parser = argparse.ArgumentParser(
        description='FleetWorks Video Event Simulator',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python video-event-simulator.py harsh_brake
  python video-event-simulator.py collision --count 5 --interval 3
  python video-event-simulator.py speeding --video "s3://my-bucket/video.mp4"
  python video-event-simulator.py lane_departure --count 10 --verbose
        '''
    )

    parser.add_argument('event_type', help='Event type to simulate',
                        choices=list(EVENT_TYPES.keys()))
    parser.add_argument('--count', '-c', type=int, default=1,
                        help='Number of events to generate (default: 1)')
    parser.add_argument('--interval', '-i', type=int, default=5,
                        help='Interval between events in seconds (default: 5)')
    parser.add_argument('--video', '-v', help='Custom video URL to use')
    parser.add_argument('--verbose', '-V', action='store_true',
                        help='Verbose output')

    args = parser.parse_args()

    # Check environment
    if not SUPABASE_ANON_KEY or SUPABASE_ANON_KEY == 'your-anon-key':
        print("❌ Error: SUPABASE_ANON_KEY not set")
        print("Set environment variables:")
        print("  export SUPABASE_URL=https://your-project.supabase.co")
        print("  export SUPABASE_ANON_KEY=your-key-here")
        return 1

    # Run simulation
    simulate_events(
        event_type=args.event_type,
        count=args.count,
        interval=args.interval,
        video_url=args.video,
        verbose=args.verbose
    )

    return 0


if __name__ == '__main__':
    exit(main())
