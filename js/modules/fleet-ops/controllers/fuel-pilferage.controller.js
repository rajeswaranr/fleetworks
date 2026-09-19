/**
 * Fuel Pilferage Detection Controller
 * Detects fuel consumption anomalies and flags suspicious trips
 */

let fuelPilferageData = {
  trips: [],
  anomalies: [],
  baselines: {},
  stats: {
    totalTrips: 0,
    anomalousTrips: 0,
    estimatedLoss: 0,
    criticalAlerts: 0
  }
};

async function initFuelPilferage() {
  console.log('Initializing Fuel Pilferage Detection...');
  try {
    if (!window.supabaseUser) return;

    // Load recent fuel trips
    const { data: trips } = await window.supabase
      .from('fuel_trips')
      .select('*, vehicle:vehicle_id(registration, vehicle_type), driver:driver_id(name)')
      .eq('org_id', window.supabaseUser.org_id)
      .gte('trip_date', new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0])
      .order('trip_date', { ascending: false });

    // Load consumption baselines
    const { data: baselines } = await window.supabase
      .from('fuel_consumption_baseline')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id);

    // Load fuel alerts
    const { data: alerts } = await window.supabase
      .from('fuel_alerts')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('is_reviewed', false)
      .order('created_at', { ascending: false });

    fuelPilferageData.trips = trips || [];
    fuelPilferageData.baselines = (baselines || []).reduce((acc, b) => {
      acc[b.vehicle_id] = b;
      return acc;
    }, {});
    fuelPilferageData.anomalies = alerts || [];

    calculatePilferageStats();
    renderFuelPilferage();
  } catch (error) {
    console.error('Fuel pilferage error:', error);
  }
}

function calculatePilferageStats() {
  const anomalousTrips = fuelPilferageData.trips.filter(t => t.is_anomalous);
  const criticalAlerts = fuelPilferageData.anomalies.filter(a => a.severity === 'critical');
  const estimatedLoss = fuelPilferageData.anomalies.reduce((sum, a) => sum + (a.estimated_loss_liters || 0), 0);

  fuelPilferageData.stats = {
    totalTrips: fuelPilferageData.trips.length,
    anomalousTrips: anomalousTrips.length,
    anomalyRate: fuelPilferageData.trips.length > 0 ? ((anomalousTrips.length / fuelPilferageData.trips.length) * 100).toFixed(1) : 0,
    estimatedLoss: estimatedLoss.toFixed(2),
    estimatedLossCost: (estimatedLoss * 90).toFixed(0), // ₹90/liter avg
    criticalAlerts: criticalAlerts.length
  };
}

function renderFuelPilferage() {
  const container = document.querySelector('#tab-fuel-pilferage') || document.getElementById('fuelPilferageContainer');
  if (!container) return;

  const stats = fuelPilferageData.stats;

  let html = `
    <div style="padding:20px">
      <h2 style="margin:0 0 20px 0">⛽ Fuel Pilferage Detection</h2>

      <!-- KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
          <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Trips Analyzed</div>
          <div style="font-size:2rem;font-weight:bold">${stats.totalTrips}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Last 30 days</div>
        </div>
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #ef4444">
          <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Anomalies Detected</div>
          <div style="font-size:2rem;font-weight:bold;color:#ef4444">${stats.anomalousTrips}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">${stats.anomalyRate}% anomaly rate</div>
        </div>
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
          <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Estimated Loss</div>
          <div style="font-size:2rem;font-weight:bold;color:#f59e0b">${stats.estimatedLoss}L</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">₹${stats.estimatedLossCost}</div>
        </div>
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #ef4444">
          <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Critical Alerts</div>
          <div style="font-size:2rem;font-weight:bold;color:#ef4444">${stats.criticalAlerts}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Require review</div>
        </div>
      </div>

      <!-- How It Works -->
      <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
        <h3 style="margin:0 0 12px 0">🔍 Detection Method</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:0.9rem">
          <div>
            <strong>1. Baseline</strong><br/>
            <span style="color:var(--text-muted)">Vehicle avg efficiency (L/100km)</span>
          </div>
          <div>
            <strong>2. Actual vs Expected</strong><br/>
            <span style="color:var(--text-muted)">Compare actual consumption to baseline</span>
          </div>
          <div>
            <strong>3. Flag Variance</strong><br/>
            <span style="color:var(--text-muted)">Alert if variance > ±25%</span>
          </div>
        </div>
      </div>

      <!-- Critical Alerts -->
      ${fuelPilferageData.anomalies.length > 0 ? `
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">🚨 Critical Alerts</h3>
          ${fuelPilferageData.anomalies.filter(a => a.severity === 'critical').slice(0, 5).map(alert => `
            <div style="padding:12px;background:var(--surface-1);border-left:4px solid #ef4444;border-radius:6px;margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                <div>
                  <div style="font-weight:600">${alert.alert_type.replace(/_/g, ' ').toUpperCase()}</div>
                  <div style="font-size:0.85rem;color:var(--text-muted)">${alert.description}</div>
                </div>
                <div style="font-weight:bold;color:#ef4444">Loss: ${alert.estimated_loss_liters}L (₹${alert.estimated_loss_amount})</div>
              </div>
              <div style="font-size:0.8rem;color:var(--text-muted);padding-top:8px;border-top:1px solid var(--border)">
                Confidence: ${alert.confidence_score}% | ${new Date(alert.created_at).toLocaleDateString('en-IN')}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Anomalous Trips -->
      <div style="padding:16px;background:var(--surface-2);border-radius:8px">
        <h3 style="margin:0 0 12px 0">📊 Anomalous Trips (30 days)</h3>
        ${fuelPilferageData.trips.filter(t => t.is_anomalous).slice(0, 15).map(trip => {
          const variance = trip.consumption_variance_pct || 0;
          const varColor = variance > 0 ? '#ef4444' : '#3b82f6';
          const varText = variance > 0 ? `+${variance}%` : `${variance}%`;

          return `
            <div style="padding:12px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;align-items:center">
              <div>
                <div style="font-weight:600">${trip.vehicle?.registration || 'Unknown'}</div>
                <div style="font-size:0.85rem;color:var(--text-muted)">${trip.driver?.name || 'No driver'}</div>
              </div>
              <div>
                <div style="font-size:0.85rem;color:var(--text-muted)">Distance</div>
                <div style="font-weight:600">${trip.distance_km}km</div>
              </div>
              <div>
                <div style="font-size:0.85rem;color:var(--text-muted)">Consumption</div>
                <div style="font-weight:600">${trip.actual_consumption_liters}L (Expected: ${trip.expected_consumption_liters}L)</div>
              </div>
              <div style="text-align:right">
                <div style="padding:6px 12px;background:${varColor}20;color:${varColor};border-radius:6px;font-weight:bold">${varText}</div>
                <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">${new Date(trip.trip_date).toLocaleDateString('en-IN')}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// Subscribe to new fuel trips for realtime detection
function subscribeToFuelTrips() {
  if (!window.supabaseUser) return;

  const subscription = window.supabase
    .channel('fuel_trips')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fuel_trips' }, (payload) => {
      console.log('New fuel trip:', payload.new);
      setTimeout(initFuelPilferage, 1000);
    })
    .subscribe();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      initFuelPilferage();
      subscribeToFuelTrips();
    }, 100);
  });
} else {
  setTimeout(() => {
    initFuelPilferage();
    subscribeToFuelTrips();
  }, 100);
}
