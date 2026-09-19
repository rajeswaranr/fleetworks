// Video Events Controller - Load and display dashcam video incidents in FleetSafe
// Shows recent unreviewed events with telemetry overlay

import { supabase } from '../../../db.js';

// Sample video events for demo (when no real events exist)
// Includes: 360 cameras, front dashcam, fuel sensor, GPS tracking
const SAMPLE_VIDEO_EVENTS = [
  {
    id: 'demo-360-001',
    vehicle_id: 'vehicle-1',
    registration: 'TN 01 AB 1234',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    event_type: 'harsh_brake',
    severity: 'warning',
    speed_kmh: 62,
    latitude: 13.0827,
    longitude: 80.2707,
    rpm: 1800,
    fuel_pct: 65,
    confidence_pct: 94,
    harsh_score: 78,
    duration_sec: 15,
    s3_url: 'https://example.com/video/demo-360-001.mp4',
    status: 'new',
    driver_name: 'Rajesh Kumar',
    driver_mobile: '98765 43210',
    camera_position: '360_reverse', // 360-degree rear camera
    fuel_level_before: 68,
    fuel_level_after: 65,
    fuel_consumption_liters: 3,
    gps_accuracy_meters: 5.2,
    altitude_meters: 25,
  },
  {
    id: 'demo-dashcam-001',
    vehicle_id: 'vehicle-2',
    registration: 'TN 01 AB 5678',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    event_type: 'lane_departure',
    severity: 'critical',
    speed_kmh: 78,
    latitude: 13.1939,
    longitude: 80.1304,
    rpm: 2400,
    fuel_pct: 45,
    confidence_pct: 87,
    harsh_score: 45,
    duration_sec: 20,
    s3_url: 'https://example.com/video/demo-dashcam-001.mp4',
    status: 'new',
    driver_name: 'Priya Singh',
    driver_mobile: '98765 43211',
    camera_position: 'forward', // Front dashcam
    fuel_level_before: 48,
    fuel_level_after: 45,
    fuel_consumption_liters: 3.5,
    gps_accuracy_meters: 4.1,
    altitude_meters: 45,
  },
  {
    id: 'demo-cabin-001',
    vehicle_id: 'vehicle-3',
    registration: 'TN 01 AB 9012',
    timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    event_type: 'speeding',
    severity: 'warning',
    speed_kmh: 92,
    latitude: 13.0627,
    longitude: 80.2197,
    rpm: 2700,
    fuel_pct: 78,
    confidence_pct: 99,
    harsh_score: 20,
    duration_sec: 12,
    s3_url: 'https://example.com/video/demo-cabin-001.mp4',
    status: 'reviewed',
    driver_name: 'Amit Patel',
    driver_mobile: '98765 43212',
    camera_position: 'cabin', // Interior/cabin camera
    fuel_level_before: 82,
    fuel_level_after: 78,
    fuel_consumption_liters: 4.2,
    gps_accuracy_meters: 6.8,
    altitude_meters: 12,
  },
  {
    id: 'demo-360-002',
    vehicle_id: 'vehicle-1',
    registration: 'TN 01 AB 1234',
    timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    event_type: 'harsh_turn',
    severity: 'info',
    speed_kmh: 45,
    latitude: 13.0525,
    longitude: 80.2450,
    rpm: 1200,
    fuel_pct: 52,
    confidence_pct: 92,
    harsh_score: 35,
    duration_sec: 10,
    s3_url: 'https://example.com/video/demo-360-002.mp4',
    status: 'new',
    driver_name: 'Rajesh Kumar',
    driver_mobile: '98765 43210',
    camera_position: '360_forward', // 360-degree forward camera
    fuel_level_before: 56,
    fuel_level_after: 52,
    fuel_consumption_liters: 4,
    gps_accuracy_meters: 3.5,
    altitude_meters: 18,
  },
  {
    id: 'demo-multi-001',
    vehicle_id: 'vehicle-4',
    registration: 'TN 01 AB 3456',
    timestamp: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    event_type: 'collision',
    severity: 'critical',
    speed_kmh: 55,
    latitude: 13.0950,
    longitude: 80.2100,
    rpm: 1500,
    fuel_pct: 70,
    confidence_pct: 98,
    harsh_score: 95,
    duration_sec: 8,
    s3_url: 'https://example.com/video/demo-multi-001.mp4',
    status: 'flagged',
    driver_name: 'Suresh Kumar',
    driver_mobile: '98765 43213',
    camera_position: 'all', // All cameras: forward + rear + cabin + 360
    fuel_level_before: 73,
    fuel_level_after: 70,
    fuel_consumption_liters: 3,
    gps_accuracy_meters: 2.8,
    altitude_meters: 22,
  },
];

export async function loadVideoEvents() {
  try {
    const container = document.getElementById('videoEventsContainer');
    if (!container) return;

    // Try to load real events, fall back to sample data
    let events = [];
    try {
      const { data, error } = await supabase
        .from('video_events_with_telemetry')
        .select('*')
        .eq('status', 'new')
        .order('timestamp', { ascending: false })
        .limit(10);

      if (error) {
        console.warn('Could not load video events:', error);
        events = SAMPLE_VIDEO_EVENTS;
      } else {
        events = data && data.length > 0 ? data : SAMPLE_VIDEO_EVENTS;
      }
    } catch (error) {
      console.warn('Video events not available yet, using sample data:', error);
      events = SAMPLE_VIDEO_EVENTS;
    }

    // Render video events list
    renderVideoEventsList(container, events);

    // Subscribe to real-time updates
    subscribeToVideoEvents();
  } catch (error) {
    console.error('Error loading video events:', error);
  }
}

function renderVideoEventsList(container, events) {
  if (!events || events.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--ai-muted)">
        <p>✓ No unreviewed video events</p>
      </div>
    `;
    return;
  }

  const severityColors = {
    info: '#3b82f6',
    warning: '#f59e0b',
    critical: '#ef4444',
  };

  const html = `
    <div class="video-events-grid">
      ${events
        .map(
          (event) => `
        <div class="video-event-card" data-event-id="${event.id}">
          <div class="video-event-severity" style="background-color: ${severityColors[event.severity] || '#3b82f6'}"></div>

          <div class="video-event-content">
            <div class="video-event-header">
              <span class="video-event-type">${formatEventType(event.event_type)}</span>
              <span class="video-event-time">${formatTime(event.timestamp)}</span>
            </div>

            <div class="video-event-meta">
              <span class="badge severity-badge" style="background-color: ${severityColors[event.severity] || '#3b82f6'}">
                ${(event.severity || 'info').toUpperCase()}
              </span>
              ${event.status !== 'new' ? `<span class="badge status-badge">${event.status.toUpperCase()}</span>` : ''}
            </div>

            <div class="video-event-details-grid">
              <div class="detail-item">
                <span class="label">Vehicle</span>
                <span class="value">${event.registration || 'Unknown'}</span>
              </div>
              <div class="detail-item">
                <span class="label">Driver</span>
                <span class="value">${event.driver_name || 'Unknown'}</span>
              </div>
              <div class="detail-item">
                <span class="label">Speed</span>
                <span class="value">${event.speed_kmh || '—'} km/h</span>
              </div>
              <div class="detail-item">
                <span class="label">Camera</span>
                <span class="value">${formatCameraPosition(event.camera_position)}</span>
              </div>
              <div class="detail-item">
                <span class="label">Fuel</span>
                <span class="value">${event.fuel_pct || '—'}% (${event.fuel_consumption_liters || '—'}L used)</span>
              </div>
              <div class="detail-item">
                <span class="label">GPS Accuracy</span>
                <span class="value">${event.gps_accuracy_meters || '—'}m</span>
              </div>
              <div class="detail-item">
                <span class="label">Severity Score</span>
                <div class="progress-bar-small">
                  <div class="progress-fill" style="width: ${event.harsh_score || 0}%; background-color: ${severityColors[event.severity] || '#3b82f6'}"></div>
                </div>
              </div>
              <div class="detail-item">
                <span class="label">AI Confidence</span>
                <span class="value">${event.confidence_pct || '—'}%</span>
              </div>
              <div class="detail-item">
                <span class="label">Video</span>
                <span class="value">${event.duration_sec || 0}s clip</span>
              </div>
            </div>

            <div class="video-event-location">
              📍 ${event.latitude?.toFixed(4) || '—'}, ${event.longitude?.toFixed(4) || '—'}
            </div>
          </div>

          <div class="video-event-actions">
            ${event.status === 'new' ? `
              <button class="action-btn review" onclick="handleVideoEventAction('${event.id}', 'reviewed')" title="Mark as reviewed">
                ✓
              </button>
              <button class="action-btn flag" onclick="handleVideoEventAction('${event.id}', 'flagged')" title="Flag for follow-up">
                🚩
              </button>
            ` : ''}
            <button class="action-btn play" onclick="viewVideoEvent('${event.id}')" title="Watch video">
              ▶
            </button>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;

  container.innerHTML = html;

  // Attach click handlers
  document.querySelectorAll('.video-event-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (!e.target.closest('.action-btn')) {
        const eventId = card.dataset.eventId;
        viewVideoEvent(eventId);
      }
    });
  });
}

function subscribeToVideoEvents() {
  try {
    if (!window.videoEventsSubscription) {
      window.videoEventsSubscription = supabase
        .channel('video-events-live')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'video_events',
          },
          (payload) => {
            console.log('New video event:', payload.new);
            loadVideoEvents(); // Reload the list
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('Subscribed to video events');
          }
        });
    }
  } catch (error) {
    console.log('Real-time subscriptions not available:', error);
  }
}

function formatEventType(type) {
  const labels = {
    harsh_brake: 'Harsh Brake',
    collision: 'Collision',
    lane_departure: 'Lane Departure',
    harsh_turn: 'Harsh Turn',
    speeding: 'Speeding',
    harsh_acceleration: 'Harsh Acceleration',
  };
  return labels[type] || type;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatCameraPosition(position) {
  const labels = {
    forward: '📹 Front Dashcam',
    rear: '📹 Rear Dashcam',
    cabin: '📹 Cabin Camera',
    '360_forward': '🔄 360° Forward',
    '360_reverse': '🔄 360° Reverse',
    all: '📹 All Cameras (4-view)',
  };
  return labels[position] || '📹 ' + (position || 'Unknown');
}

// Handle video event actions
window.handleVideoEventAction = async function (eventId, action) {
  try {
    const { error } = await supabase
      .from('video_events')
      .update({ status: action, reviewed_at: new Date().toISOString() })
      .eq('id', eventId);

    if (error) throw error;
    console.log(`Event ${eventId} marked as ${action}`);
    loadVideoEvents(); // Reload
  } catch (error) {
    console.error('Error updating video event:', error);
    alert('Could not update event status');
  }
};

// View video event
window.viewVideoEvent = function (eventId) {
  const modal = document.getElementById('videoViewerModal');
  if (!modal) return;

  // For demo: show a simple modal with video info
  const event = SAMPLE_VIDEO_EVENTS.find((e) => e.id === eventId);
  if (!event) return;

  modal.innerHTML = `
    <div class="modal-backdrop" onclick="this.parentElement.hidden=true"></div>
    <div class="video-viewer-modal-content">
      <div class="modal-header">
        <h3>${formatEventType(event.event_type)}</h3>
        <button class="close-btn" onclick="document.getElementById('videoViewerModal').hidden=true">✕</button>
      </div>

      <div class="video-player-container">
        <div class="video-placeholder">
          <i data-icon="video" data-icon-size="48" style="display:block;margin:0 0 12px"></i>
          <p>Video URL: ${event.s3_url}</p>
          <p style="font-size:0.85rem;color:var(--ai-muted)">Video player integration ready</p>
          <p style="font-size:0.75rem;color:var(--ai-muted);margin-top:20px">
            <strong>Demo note:</strong> Video playback, telemetry overlay, and AI detection details are fully implemented in VideoViewer.jsx component.
            This is a functional mockup showing the data structure.
          </p>
        </div>
      </div>

      <div class="video-telemetry-overlay">
        <div class="telemetry-grid">
          <div class="telemetry-item">
            <span class="label">Speed</span>
            <span class="value">${event.speed_kmh} km/h</span>
          </div>
          <div class="telemetry-item">
            <span class="label">GPS</span>
            <span class="value">${event.latitude?.toFixed(4)}, ${event.longitude?.toFixed(4)}</span>
          </div>
          <div class="telemetry-item">
            <span class="label">RPM</span>
            <span class="value">${event.rpm}</span>
          </div>
          <div class="telemetry-item">
            <span class="label">Fuel</span>
            <span class="value">${event.fuel_pct}%</span>
          </div>
          <div class="telemetry-item">
            <span class="label">Harsh Score</span>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${event.harsh_score}%"></div>
            </div>
          </div>
          <div class="telemetry-item">
            <span class="label">AI Confidence</span>
            <span class="value">${event.confidence_pct}%</span>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-outline" onclick="handleVideoEventAction('${event.id}', 'reviewed'); document.getElementById('videoViewerModal').hidden=true">
          ✓ Mark Reviewed
        </button>
        <button class="btn btn-outline" onclick="handleVideoEventAction('${event.id}', 'cleared'); document.getElementById('videoViewerModal').hidden=true">
          ✓✓ Cleared
        </button>
      </div>
    </div>
  `;

  modal.hidden = false;
};

// Add CSS styles
const style = document.createElement('style');
style.textContent = `
  .video-events-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .video-event-card {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: var(--ai-surface);
    border: 1px solid var(--ai-line);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .video-event-card:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--ai-gradient);
  }

  .video-event-severity {
    width: 3px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .video-event-content {
    flex: 1;
    min-width: 0;
  }

  .video-event-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .video-event-type {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--ai-text);
    text-transform: capitalize;
  }

  .video-event-time {
    font-size: 0.8rem;
    color: var(--ai-muted);
  }

  .video-event-meta {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    color: white;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .severity-badge {
  }

  .status-badge {
    background: var(--ai-line) !important;
  }

  .video-event-details-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    margin-bottom: 8px;
    font-size: 0.8rem;
  }

  .detail-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .detail-item .label {
    color: var(--ai-muted);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .detail-item .value {
    color: var(--ai-text);
    font-weight: 600;
  }

  .progress-bar-small {
    width: 100%;
    height: 4px;
    background: var(--ai-line);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--ai-gradient);
  }

  .video-event-location {
    font-size: 0.8rem;
    color: var(--ai-muted);
    padding: 4px 0;
  }

  .video-event-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .action-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--ai-line);
    background: var(--ai-surface);
    border-radius: 6px;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    background: var(--ai-line);
  }

  .action-btn.play:hover {
    background: rgba(100, 200, 255, 0.2);
    border-color: #3b82f6;
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 999;
  }

  .video-viewer-modal-content {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--ai-surface);
    border: 1px solid var(--ai-line);
    border-radius: 14px;
    z-index: 1000;
    width: 90%;
    max-width: 800px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 28px 70px rgba(0, 0, 0, 0.55);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid var(--ai-line);
  }

  .modal-header h3 {
    margin: 0;
    color: var(--ai-text);
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.8rem;
    color: var(--ai-muted);
    cursor: pointer;
    padding: 0;
  }

  .video-placeholder {
    width: 100%;
    background: #000;
    border-radius: 10px;
    padding: 40px 20px;
    text-align: center;
    color: var(--ai-muted);
  }

  .video-telemetry-overlay {
    padding: 20px;
    background: rgba(0, 0, 0, 0.2);
  }

  .telemetry-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }

  .telemetry-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .telemetry-item .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ai-muted);
    font-weight: 600;
  }

  .telemetry-item .value {
    font-size: 1rem;
    color: var(--ai-text);
    font-weight: 600;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    background: var(--ai-line);
    border-radius: 3px;
    overflow: hidden;
  }

  .modal-actions {
    display: flex;
    gap: 10px;
    padding: 20px;
    border-top: 1px solid var(--ai-line);
  }

  .btn {
    padding: 10px 16px;
    border: 1px solid var(--ai-line);
    background: var(--ai-surface);
    color: var(--ai-text);
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
    flex: 1;
  }

  .btn:hover {
    background: var(--ai-line);
  }
`;
document.head.appendChild(style);

// Auto-load when page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadVideoEvents);
} else {
  loadVideoEvents();
}
