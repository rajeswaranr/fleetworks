/**
 * FleetSafe Dashboard
 * Driver safety monitoring, video analysis, and event tracking
 */

async function initFleetSafeDashboard() {
  console.log('Initializing FleetSafe Dashboard...');
  if (!window.supabaseUser) return;

  try {
    // KPIs: Safety events, driver ratings, alerts
    const { data: events } = await window.supabase
      .from('video_events')
      .select('severity, event_type')
      .eq('org_id', window.supabaseUser.org_id)
      .gte('timestamp', new Date(Date.now() - 30*24*60*60*1000).toISOString());

    const { data: driverScores } = await window.supabase
      .from('drivers')
      .select('safety_rating')
      .eq('org_id', window.supabaseUser.org_id);

    const criticalEvents = (events || []).filter(e => e.severity === 'critical').length;
    const avgSafetyRating = driverScores?.length ? (driverScores.reduce((s, d) => s + (d.safety_rating || 0), 0) / driverScores.length).toFixed(1) : 0;

    const dashboard = document.getElementById('fleetSafeDashboard') || document.querySelector('[data-section="fleetsafe"]');
    if (!dashboard) return;

    dashboard.innerHTML = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">🛡️ FleetSafe Dashboard</h2>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #ef4444">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Critical Events (30 days)</div>
            <div style="font-size:2rem;font-weight:bold">${criticalEvents}</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Average Driver Rating</div>
            <div style="font-size:2rem;font-weight:bold">⭐ ${avgSafetyRating}/5</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Video Events Tracked</div>
            <div style="font-size:2rem;font-weight:bold">${events?.length || 0}</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Coverage</div>
            <div style="font-size:2rem;font-weight:bold">📹 Live</div>
          </div>
        </div>

        <div style="padding:16px;background:var(--surface-2);border-radius:8px">
          <h3 style="margin:0 0 12px 0">Key Features</h3>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">🎥 Live Dashcam</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Real-time video from all vehicles</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">🤖 AI Event Detection</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Auto-detect harsh braking, collisions, speeding</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">⚠️ Alerts</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Real-time push notifications for critical events</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">📊 Driver Scorecards</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Safety ratings and coaching recommendations</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('FleetSafe error:', error);
  }
}

setTimeout(initFleetSafeDashboard, 100);
