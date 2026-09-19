/**
 * Safety Events Controller
 * Loads and displays safety events for review, driver scorecards, and coaching
 */

let safetyData = {
  events: [],
  scorecards: [],
  coachingSessions: []
};

async function initSafetyDash() {
  console.log('Initializing Safety Dashboard...');
  try {
    if (!window.supabaseUser) {
      showSafetyPlaceholder();
      return;
    }

    // Load safety events
    const { data: events } = await window.supabase
      .from('video_events')
      .select('*, vehicle:vehicle_id(registration), driver:driver_id(name)')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('status', 'new')
      .order('timestamp', { ascending: false })
      .limit(50);

    safetyData.events = events || [];

    // Load driver scorecards (last 30 days)
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 30);

    const { data: scoreData } = await window.supabase
      .from('video_events')
      .select('driver_id, severity, harsh_score')
      .eq('org_id', window.supabaseUser.org_id)
      .gte('timestamp', dateFrom.toISOString());

    // Group by driver
    const byDriver = {};
    (scoreData || []).forEach(event => {
      if (!byDriver[event.driver_id]) {
        byDriver[event.driver_id] = { events: 0, critical: 0, score: 0 };
      }
      byDriver[event.driver_id].events++;
      if (event.severity === 'critical') byDriver[event.driver_id].critical++;
      byDriver[event.driver_id].score += event.harsh_score || 0;
    });

    safetyData.scorecards = Object.entries(byDriver).map(([driverId, data]) => ({
      driverId,
      totalEvents: data.events,
      criticalEvents: data.critical,
      avgScore: data.score / data.events
    }));

    renderSafetyDash();
  } catch (error) {
    console.error('Safety dashboard error:', error);
    showSafetyError(error.message);
  }
}

function renderSafetyDash() {
  const events = safetyData.events;
  const scorecards = safetyData.scorecards.sort((a, b) => b.criticalEvents - a.criticalEvents);

  // Update counts
  document.getElementById('safetyUpdated').textContent = `${events.length} events`;

  // Render stats
  const stats = calculateSafetyStats(events);
  renderSafetyStats(stats);

  // Render events
  renderSafetyEvents(events);

  // Render scorecards
  renderDriverScores(scorecards);

  // Render coaching sessions
  renderCoachingSessions();
}

function calculateSafetyStats(events) {
  return {
    totalEvents: events.length,
    criticalEvents: events.filter(e => e.severity === 'critical').length,
    warningEvents: events.filter(e => e.severity === 'warning').length,
    avgScore: events.length > 0 ? events.reduce((sum, e) => sum + (e.harsh_score || 0), 0) / events.length : 0
  };
}

function renderSafetyStats(stats) {
  const html = `
    <div class="stat-card">
      <div class="stat-label">Unreviewed Events</div>
      <div class="stat-value">${stats.totalEvents}</div>
      <div class="stat-unit">events</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Critical</div>
      <div class="stat-value" style="color:#ef4444">${stats.criticalEvents}</div>
      <div class="stat-unit">need attention</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Warnings</div>
      <div class="stat-value" style="color:#f59e0b">${stats.warningEvents}</div>
      <div class="stat-unit">moderate risk</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg Score</div>
      <div class="stat-value">${stats.avgScore.toFixed(0)}</div>
      <div class="stat-unit">0-100</div>
    </div>
  `;
  const container = document.getElementById('safetyStats');
  if (container) container.innerHTML = html;
}

function renderSafetyEvents(events) {
  const container = document.getElementById('safetyEvents');
  if (!container || events.length === 0) {
    if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No unreviewed events</div>';
    return;
  }

  const html = events.slice(0, 10).map(e => `
    <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);margin-bottom:8px;border-left:4px solid ${e.severity === 'critical' ? '#ef4444' : e.severity === 'warning' ? '#f59e0b' : '#3b82f6'}">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <div style="font-weight:600">${e.event_type?.replace(/_/g, ' ').toUpperCase() || 'Unknown'}</div>
        <button class="btn btn-primary btn-sm" onclick="assignCoaching('${e.id}')">Assign Coaching</button>
      </div>
      <div style="font-size:0.85rem;color:var(--text-muted)">
        ${e.vehicle?.registration || 'Unknown'} • ${new Date(e.timestamp).toLocaleString('en-IN')} • Score: ${e.harsh_score || 0}
      </div>
    </div>
  `).join('');

  container.innerHTML = html;
}

function renderDriverScores(scorecards) {
  const container = document.getElementById('safetyScores');
  if (!container || scorecards.length === 0) {
    if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No driver data</div>';
    return;
  }

  const html = scorecards.slice(0, 10).map(s => `
    <div style="padding:12px;background:var(--surface-2);border-radius:6px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:600">Driver ${s.driverId.slice(0, 8)}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">${s.totalEvents} events, ${s.criticalEvents} critical</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:1.2rem;font-weight:bold;color:${s.avgScore > 70 ? '#ef4444' : s.avgScore > 50 ? '#f59e0b' : '#10b981'}">${s.avgScore.toFixed(0)}</div>
        <div style="font-size:0.8rem;color:var(--text-muted)">avg score</div>
      </div>
    </div>
  `).join('');

  container.innerHTML = html;
}

function renderCoachingSessions() {
  const container = document.getElementById('safetyCoaching');
  if (!container) return;

  container.innerHTML = `
    <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.9rem">
      No open coaching sessions
    </div>
  `;
}

function assignCoaching(eventId) {
  console.log('Assign coaching for event:', eventId);
  document.getElementById('coachModal').hidden = false;
}

function showSafetyPlaceholder() {
  const container = document.getElementById('safetyEvents');
  if (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Sign in to view safety events</div>';
  }
}

function showSafetyError(message) {
  const container = document.getElementById('safetyEvents');
  if (container) {
    container.innerHTML = `<div style="padding:16px;background:#fee2e2;border-radius:8px;color:#b91c1c">Error: ${message}</div>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => initSafetyDash(), 100));
} else {
  setTimeout(() => initSafetyDash(), 100);
}
