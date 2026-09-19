/**
 * Live Video Dashboard Controller
 * Displays live camera feeds from all vehicles with real-time status
 */

let liveVideoDashboardData = {
  vehicles: [],
  activeStreams: {},
  selectedVehicleId: null,
  gridMode: true
};

async function initLiveVideoDashboard() {
  console.log('Initializing Live Video Dashboard...');
  try {
    if (!window.supabaseUser) {
      showVideoPlaceholder();
      return;
    }

    // Load vehicles with camera status
    const { data: vehicles } = await window.supabase
      .from('vehicles')
      .select('*, camera_config:camera_configurations(*), latest_frame:video_frames(*, event:video_events(*))')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('camera_config.is_active', true)
      .order('registration');

    liveVideoDashboardData.vehicles = vehicles || [];
    renderLiveVideoDashboard();
  } catch (error) {
    console.error('Live video dashboard error:', error);
    showVideoError(error.message);
  }
}

function renderLiveVideoDashboard() {
  const container = document.getElementById('liveVideoContainer') || document.querySelector('[data-tab="live-video"]');
  if (!container) return;

  const vehicles = liveVideoDashboardData.vehicles;

  // Control bar
  let html = `
    <div style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--surface-2);border-radius:8px">
      <div>
        <div style="font-weight:600;margin-bottom:8px">📹 Live Vehicle Feeds</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">${vehicles.length} vehicles with active cameras</div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="toggleVideoGridMode(true)" style="padding:8px 16px;background:${liveVideoDashboardData.gridMode ? '#3b82f6' : '#444'};color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600">
          🔲 Grid
        </button>
        <button onclick="toggleVideoGridMode(false)" style="padding:8px 16px;background:${!liveVideoDashboardData.gridMode ? '#3b82f6' : '#444'};color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600">
          🎬 Single
        </button>
      </div>
    </div>
  `;

  if (liveVideoDashboardData.gridMode) {
    // Grid view - multiple cameras
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:20px">`;

    vehicles.slice(0, 16).forEach(v => {
      const camera = v.camera_config?.length > 0 ? v.camera_config[0] : null;
      const event = v.latest_frame?.event?.[0];
      const hasAlert = event && event.severity === 'critical';

      html += `
        <div onclick="selectVideoStream('${v.id}')" style="cursor:pointer;border:2px solid ${liveVideoDashboardData.selectedVehicleId === v.id ? '#3b82f6' : '#444'};border-radius:8px;overflow:hidden;background:#000;position:relative;padding-bottom:56.25%;height:0">
          <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;justify-content:space-between;padding:8px;background:rgba(0,0,0,0.5)">
            <div>
              <div style="background:${hasAlert ? '#ef4444' : '#10b981'};color:white;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:bold;display:inline-block;margin-bottom:4px">
                ${hasAlert ? '🚨 ALERT' : '✓ LIVE'}
              </div>
            </div>
            <div style="background:rgba(0,0,0,0.7);padding:8px;border-radius:4px;color:white;font-size:12px">
              <div style="font-weight:600">${v.registration}</div>
              <div style="font-size:0.8rem;color:#aaa">${camera?.camera_type || 'Unknown'}</div>
            </div>
          </div>
        </div>
      `;
    });

    html += '</div>';
  } else {
    // Single vehicle focus view
    const selected = vehicles.find(v => v.id === liveVideoDashboardData.selectedVehicleId) || vehicles[0];

    if (selected) {
      const camera = selected.camera_config?.length > 0 ? selected.camera_config[0] : null;
      const event = selected.latest_frame?.event?.[0];

      html += `
        <div style="margin-bottom:20px;padding:12px;background:var(--surface-2);border-radius:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div>
              <div style="font-weight:600;font-size:1.2rem">${selected.registration}</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">${camera?.camera_type || 'Unknown'} • Last update: ${new Date().toLocaleTimeString('en-IN')}</div>
            </div>
            <div style="display:flex;gap:8px">
              ${event?.severity === 'critical' ? `<div style="padding:6px 12px;background:#ef4444;color:white;border-radius:6px;font-weight:bold">🚨 ALERT: ${event.event_type?.replace(/_/g, ' ').toUpperCase()}</div>` : ''}
              <div style="padding:6px 12px;background:#10b981;color:white;border-radius:6px;font-weight:bold">🟢 LIVE</div>
            </div>
          </div>
          <div style="background:#000;border-radius:8px;overflow:hidden;position:relative;width:100%;padding-bottom:56.25%;height:0">
            <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666">
              📹 Live Stream (${camera?.rtmp_url || 'HLS Stream'})
            </div>
          </div>
        </div>

        <!-- Vehicle selector -->
        <div style="margin-top:20px">
          <div style="font-weight:600;margin-bottom:12px">📋 Select Vehicle</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">
            ${vehicles.map(v => `
              <button onclick="selectVideoStream('${v.id}')" style="padding:8px;background:${v.id === selected.id ? '#3b82f6' : 'var(--surface-2)'};color:${v.id === selected.id ? 'white' : 'inherit'};border:1px solid var(--border);border-radius:6px;cursor:pointer;font-weight:600">
                ${v.registration}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

function toggleVideoGridMode(gridMode) {
  liveVideoDashboardData.gridMode = gridMode;
  renderLiveVideoDashboard();
}

function selectVideoStream(vehicleId) {
  liveVideoDashboardData.selectedVehicleId = vehicleId;
  renderLiveVideoDashboard();
}

function showVideoPlaceholder() {
  const container = document.getElementById('liveVideoContainer');
  if (container) {
    container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-muted)"><div style="font-size:2rem;margin-bottom:12px">📹</div>Sign in to view live vehicle feeds</div>';
  }
}

function showVideoError(message) {
  const container = document.getElementById('liveVideoContainer');
  if (container) {
    container.innerHTML = `<div style="padding:16px;background:#fee2e2;border-radius:8px;color:#b91c1c">Error: ${message}</div>`;
  }
}

// Subscribe to realtime video events for live updates
function subscribeToVideoEvents() {
  if (!window.supabaseUser) return;

  const subscription = window.supabase
    .channel('video_events')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'video_events' }, (payload) => {
      console.log('New video event:', payload.new);
      // Refresh dashboard when new events arrive
      setTimeout(initLiveVideoDashboard, 1000);
    })
    .subscribe();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      initLiveVideoDashboard();
      subscribeToVideoEvents();
    }, 100);
  });
} else {
  setTimeout(() => {
    initLiveVideoDashboard();
    subscribeToVideoEvents();
  }, 100);
}
