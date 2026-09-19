/**
 * Video Configuration Controller
 * Configurable settings for live streaming and video recording
 */

let videoConfigData = {
  settings: {
    hlsUrl: 'http://localhost:8080/hls',
    rtmpServer: 'rtmp://localhost:1935/live',
    streamQuality: '720p',
    recordingEnabled: true,
    alertsEnabled: true,
    autoPlayback: true,
    gridColumns: 4,
    refreshInterval: 5000,
    retentionDays: 30
  },
  streamServers: []
};

async function initVideoConfig() {
  console.log('Initializing Video Configuration...');
  try {
    if (!window.supabaseUser) return;

    // Load video configuration from DB
    const { data: config } = await window.supabase
      .from('video_configuration')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .single();

    if (config) {
      videoConfigData.settings = { ...videoConfigData.settings, ...config.settings };
    }

    // Load available stream servers
    const { data: servers } = await window.supabase
      .from('streaming_servers')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('is_active', true);

    videoConfigData.streamServers = servers || [];
    renderVideoConfig();
  } catch (error) {
    console.error('Video config error:', error);
  }
}

function renderVideoConfig() {
  const container = document.querySelector('#tab-video-config') || document.getElementById('videoConfigContainer');
  if (!container) return;

  const settings = videoConfigData.settings;

  let html = `
    <div style="max-width:800px;margin:0 auto">
      <div style="margin-bottom:20px">
        <h3 style="margin:0 0 16px 0">🎬 Video Streaming Configuration</h3>

        <!-- Stream Server Settings -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:16px">
          <h4 style="margin:0 0 12px 0">Stream Servers</h4>
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:0.9rem;font-weight:600;margin-bottom:4px">HLS URL</label>
            <input type="text" id="hlsUrl" value="${settings.hlsUrl}" placeholder="http://localhost:8080/hls" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text);box-sizing:border-box;font-family:monospace;font-size:0.85rem" onchange="updateVideoConfig('hlsUrl', this.value)">
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Used for playback in dashboard</div>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:0.9rem;font-weight:600;margin-bottom:4px">RTMP Server</label>
            <input type="text" id="rtmpServer" value="${settings.rtmpServer}" placeholder="rtmp://localhost:1935/live" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text);box-sizing:border-box;font-family:monospace;font-size:0.85rem" onchange="updateVideoConfig('rtmpServer', this.value)">
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Dashcams push RTMP streams here</div>
          </div>
        </div>

        <!-- Quality & Recording Settings -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:16px">
          <h4 style="margin:0 0 12px 0">Quality & Recording</h4>
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:0.9rem;font-weight:600;margin-bottom:4px">Stream Quality</label>
            <select id="streamQuality" onchange="updateVideoConfig('streamQuality', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text)">
              <option value="360p" ${settings.streamQuality === '360p' ? 'selected' : ''}>360p (Low bandwidth)</option>
              <option value="480p" ${settings.streamQuality === '480p' ? 'selected' : ''}>480p (Standard)</option>
              <option value="720p" ${settings.streamQuality === '720p' ? 'selected' : ''}>720p (HD)</option>
              <option value="1080p" ${settings.streamQuality === '1080p' ? 'selected' : ''}>1080p (Full HD)</option>
              <option value="2160p" ${settings.streamQuality === '2160p' ? 'selected' : ''}>2160p (4K)</option>
            </select>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Lower quality = less bandwidth, less detail</div>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:flex;align-items:center;font-size:0.9rem;font-weight:600;cursor:pointer">
              <input type="checkbox" id="recordingEnabled" ${settings.recordingEnabled ? 'checked' : ''} onchange="updateVideoConfig('recordingEnabled', this.checked)" style="margin-right:8px;cursor:pointer">
              Enable Recording
            </label>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-left:24px">Record all streams to storage</div>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:0.9rem;font-weight:600;margin-bottom:4px">Retention Period (days)</label>
            <input type="number" id="retentionDays" value="${settings.retentionDays}" min="7" max="365" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text);box-sizing:border-box" onchange="updateVideoConfig('retentionDays', parseInt(this.value))">
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Videos older than this are deleted</div>
          </div>
        </div>

        <!-- Alert Settings -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:16px">
          <h4 style="margin:0 0 12px 0">Alerts & Notifications</h4>
          <div style="margin-bottom:12px">
            <label style="display:flex;align-items:center;font-size:0.9rem;font-weight:600;cursor:pointer">
              <input type="checkbox" id="alertsEnabled" ${settings.alertsEnabled ? 'checked' : ''} onchange="updateVideoConfig('alertsEnabled', this.checked)" style="margin-right:8px;cursor:pointer">
              Enable Event Alerts
            </label>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-left:24px">Push notifications for harsh events, collisions, etc.</div>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:flex;align-items:center;font-size:0.9rem;font-weight:600;cursor:pointer">
              <input type="checkbox" id="autoPlayback" ${settings.autoPlayback ? 'checked' : ''} onchange="updateVideoConfig('autoPlayback', this.checked)" style="margin-right:8px;cursor:pointer">
              Auto-play on Dashboard
            </label>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-left:24px">Automatically start streams when dashboard loads</div>
          </div>
        </div>

        <!-- Grid Display Settings -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:16px">
          <h4 style="margin:0 0 12px 0">Grid Display</h4>
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:0.9rem;font-weight:600;margin-bottom:4px">Columns in Grid View</label>
            <select id="gridColumns" onchange="updateVideoConfig('gridColumns', parseInt(this.value))" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text)">
              <option value="2" ${settings.gridColumns === 2 ? 'selected' : ''}>2 columns</option>
              <option value="3" ${settings.gridColumns === 3 ? 'selected' : ''}>3 columns</option>
              <option value="4" ${settings.gridColumns === 4 ? 'selected' : ''}>4 columns</option>
              <option value="6" ${settings.gridColumns === 6 ? 'selected' : ''}>6 columns</option>
            </select>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">More columns = smaller tiles, more vehicles visible</div>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:0.9rem;font-weight:600;margin-bottom:4px">Refresh Interval (ms)</label>
            <input type="number" id="refreshInterval" value="${settings.refreshInterval}" min="1000" step="1000" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text);box-sizing:border-box" onchange="updateVideoConfig('refreshInterval', parseInt(this.value))">
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Lower = more frequent updates, higher CPU usage</div>
          </div>
        </div>

        <!-- Active Stream Servers -->
        ${videoConfigData.streamServers.length > 0 ? `
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:16px">
            <h4 style="margin:0 0 12px 0">Active Stream Servers</h4>
            ${videoConfigData.streamServers.map(s => `
              <div style="padding:8px;background:var(--surface-1);border-radius:4px;margin-bottom:8px;border-left:4px solid #10b981">
                <div style="font-weight:600">${s.name}</div>
                <div style="font-size:0.8rem;color:var(--text-muted);font-family:monospace">${s.url}</div>
                <div style="font-size:0.8rem;color:#10b981">✓ ${s.capacity || 0} vehicles</div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Save Button -->
        <div style="padding:12px;background:#10b98120;border:1px solid #10b981;border-radius:8px;text-align:center;color:#10b981;font-weight:600">
          ✓ Configuration Auto-Saved
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

async function updateVideoConfig(key, value) {
  videoConfigData.settings[key] = value;

  try {
    // Save to database
    if (window.supabaseUser) {
      await window.supabase
        .from('video_configuration')
        .upsert({
          org_id: window.supabaseUser.org_id,
          settings: videoConfigData.settings,
          updated_at: new Date().toISOString()
        }, { onConflict: 'org_id' });

      console.log(`Updated ${key} to ${value}`);
    }
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initVideoConfig, 100));
} else {
  setTimeout(initVideoConfig, 100);
}
