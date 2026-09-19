/**
 * RFID Tire Tracking System with Real-time Pressure Monitoring
 * AI-enabled analytics and predictive maintenance
 */

let tireTrackerData = {
  fleetTires: [],
  pressureReadings: [],
  anomalies: [],
  predictions: [],
  stats: {
    totalTires: 0,
    tiresMonitored: 0,
    optimalPressure: 0,
    atRisk: 0,
    avgWear: 0
  }
};

async function initTireTracker() {
  console.log('Initializing Tire Tracking System...');
  try {
    if (!window.supabaseUser) return;

    // Load tire registry
    const { data: tires } = await window.supabase
      .from('tire_registry')
      .select('*, vehicle:current_vehicle_id(registration)')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('status', 'active')
      .order('updated_at', { ascending: false });

    // Load latest pressure readings
    const { data: readings } = await window.supabase
      .from('tire_pressure_readings')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .gte('reading_timestamp', new Date(Date.now() - 24*60*60*1000).toISOString())
      .order('reading_timestamp', { ascending: false })
      .limit(1000);

    // Load anomalies (unresolved)
    const { data: anomalies } = await window.supabase
      .from('tire_anomalies')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('is_resolved', false)
      .order('detected_at', { ascending: false });

    // Load AI predictions
    const { data: predictions } = await window.supabase
      .from('tire_ai_predictions')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .order('prediction_date', { ascending: false })
      .limit(100);

    tireTrackerData.fleetTires = tires || [];
    tireTrackerData.pressureReadings = readings || [];
    tireTrackerData.anomalies = anomalies || [];
    tireTrackerData.predictions = predictions || [];

    calculateTireStats();
    renderTireTracker();
  } catch (error) {
    console.error('Tire tracker error:', error);
  }
}

function calculateTireStats() {
  const tires = tireTrackerData.fleetTires;
  const readings = tireTrackerData.pressureReadings;

  const optimal = tires.filter(t => {
    const lastReading = readings.find(r => r.tire_id === t.id);
    return lastReading && lastReading.is_normal;
  }).length;

  const atRisk = tireTrackerData.predictions.filter(p => p.failure_risk_pct > 30).length;
  const avgWear = tires.length > 0 ? tires.reduce((sum, t) => sum + (t.tread_wear_pct || 0), 0) / tires.length : 0;

  tireTrackerData.stats = {
    totalTires: tires.length,
    tiresMonitored: readings.length > 0 ? readings.map(r => r.tire_id).filter((v, i, a) => a.indexOf(v) === i).length : 0,
    optimalPressure: optimal,
    atRisk: atRisk,
    avgWear: avgWear.toFixed(1)
  };
}

function renderTireTracker() {
  const container = document.querySelector('#tab-tyre-tracker') || document.getElementById('tireTrackerContainer');
  if (!container) return;

  const stats = tireTrackerData.stats;
  const anomalies = tireTrackerData.anomalies;

  let html = `
    <div style="padding:20px">
      <h2 style="margin:0 0 20px 0">🛞 RFID Tire Tracking System</h2>

      <!-- KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
        <div style="padding:14px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6;text-align:center">
          <div style="font-size:1.8rem;font-weight:bold">${stats.totalTires}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Total Tires</div>
        </div>
        <div style="padding:14px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981;text-align:center">
          <div style="font-size:1.8rem;font-weight:bold;color:#10b981">${stats.tiresMonitored}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Live Monitored</div>
        </div>
        <div style="padding:14px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981;text-align:center">
          <div style="font-size:1.8rem;font-weight:bold;color:#10b981">${stats.optimalPressure}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Optimal Pressure</div>
        </div>
        <div style="padding:14px;background:var(--surface-2);border-radius:8px;border-left:4px solid #ef4444;text-align:center">
          <div style="font-size:1.8rem;font-weight:bold;color:#ef4444">${stats.atRisk}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">At Risk (AI)</div>
        </div>
        <div style="padding:14px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b;text-align:center">
          <div style="font-size:1.8rem;font-weight:bold;color:#f59e0b">${stats.avgWear}%</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Avg Wear</div>
        </div>
      </div>

      <!-- AI Alerts & Predictions -->
      ${anomalies.length > 0 ? `
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">🚨 AI-Detected Issues</h3>
          ${anomalies.slice(0, 8).map(a => {
            const severityColor = a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : '#3b82f6';
            return `
              <div style="padding:12px;background:var(--surface-1);border-left:4px solid ${severityColor};border-radius:6px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
                  <div style="font-weight:600">${a.anomaly_type.replace(/_/g, ' ').toUpperCase()}</div>
                  <div style="display:flex;gap:8px">
                    <span style="padding:3px 8px;background:${severityColor}20;color:${severityColor};border-radius:3px;font-size:0.75rem;font-weight:bold">${a.severity?.toUpperCase()}</span>
                    <span style="padding:3px 8px;background:#3b82f620;color:#3b82f6;border-radius:3px;font-size:0.75rem;font-weight:bold">AI ${a.ai_confidence_score}%</span>
                  </div>
                </div>
                <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:6px">${a.description}</div>
                <div style="font-size:0.8rem;color:${a.predicted_failure_risk_pct > 50 ? '#ef4444' : 'var(--text-muted)'}">
                  ⚠️ Failure Risk: ${a.predicted_failure_risk_pct}% in 7 days
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      <!-- Real-time Tire Status -->
      <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
        <h3 style="margin:0 0 12px 0">📊 Tire Status (Real-time)</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
          ${tireTrackerData.fleetTires.slice(0, 12).map(tire => {
            const lastReading = tireTrackerData.pressureReadings.find(r => r.tire_id === tire.id);
            const prediction = tireTrackerData.predictions.find(p => p.tire_id === tire.id);
            const statusColor = !lastReading ? '#999' : lastReading.is_normal ? '#10b981' : '#ef4444';

            return `
              <div style="padding:12px;border:2px solid ${statusColor};border-radius:8px;background:var(--surface-1)">
                <div style="font-weight:600;margin-bottom:8px">
                  🔖 ${tire.rfid_tag_id?.slice(-8) || 'No RFID'}
                </div>
                <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:8px">
                  ${tire.vehicle?.registration || 'Unassigned'} • ${tire.tire_size}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;margin-bottom:8px">
                  <div>
                    <span style="color:var(--text-muted)">Pressure</span><br/>
                    <span style="font-weight:600;color:${lastReading?.is_normal ? '#10b981' : '#ef4444'}">
                      ${lastReading?.pressure_psi.toFixed(1) || '-'} PSI
                    </span>
                  </div>
                  <div>
                    <span style="color:var(--text-muted)">Wear</span><br/>
                    <span style="font-weight:600">${tire.tread_wear_pct?.toFixed(0) || '-'}%</span>
                  </div>
                </div>
                ${lastReading ? `
                  <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px">
                    Temp: ${lastReading.temperature_celsius}°C • Battery: ${lastReading.battery_level_pct}%
                  </div>
                ` : ''}
                ${prediction ? `
                  <div style="padding:6px;background:${prediction.failure_risk_pct > 50 ? '#ef444420' : '#10b98120'};border-radius:4px;font-size:0.8rem">
                    <strong style="color:${prediction.failure_risk_pct > 50 ? '#ef4444' : '#10b981'}">
                      🤖 Risk: ${prediction.failure_risk_pct}%
                    </strong><br/>
                    Replace: ${new Date(prediction.recommended_replacement_date).toLocaleDateString('en-IN')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- RFID Deployment Info -->
      <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
        <h3 style="margin:0 0 12px 0">📡 RFID System Info</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:0.9rem">
          <div style="padding:12px;background:var(--surface-1);border-radius:6px">
            <div style="color:var(--text-muted);margin-bottom:4px">Tag Type</div>
            <div style="font-weight:600">Impinj Monza Gen2+</div>
            <div style="font-size:0.8rem;color:#3b82f6">915 MHz (Indian ISM band)</div>
          </div>
          <div style="padding:12px;background:var(--surface-1);border-radius:6px">
            <div style="color:var(--text-muted);margin-bottom:4px">Read Range</div>
            <div style="font-weight:600">5-10 meters</div>
            <div style="font-size:0.8rem;color:#3b82f6">Mobile RFID reader</div>
          </div>
          <div style="padding:12px;background:var(--surface-1);border-radius:6px">
            <div style="color:var(--text-muted);margin-bottom:4px">Update Frequency</div>
            <div style="font-weight:600">Real-time + 15 min</div>
            <div style="font-size:0.8rem;color:#3b82f6">TPMS integration</div>
          </div>
        </div>
      </div>

      <!-- Analytics Overview -->
      <div style="padding:16px;background:var(--surface-2);border-radius:8px">
        <h3 style="margin:0 0 12px 0">📈 Fleet Analytics</h3>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;font-size:0.9rem">
          <div style="padding:12px;background:var(--surface-1);border-radius:6px">
            <div style="color:var(--text-muted);margin-bottom:4px">Replacements (30 days)</div>
            <div style="font-weight:600;color:#ef4444">
              ${tireTrackerData.predictions.filter(p => {
                const replDate = new Date(p.recommended_replacement_date);
                const in30days = new Date(Date.now() + 30*24*60*60*1000);
                return replDate <= in30days;
              }).length} tires
            </div>
          </div>
          <div style="padding:12px;background:var(--surface-1);border-radius:6px">
            <div style="color:var(--text-muted);margin-bottom:4px">Cost Savings (AI)</div>
            <div style="font-weight:600;color:#10b981">₹${(stats.totalTires * 500).toLocaleString('en-IN')}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Via predictive maintenance</div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// Subscribe to real-time tire pressure updates
function subscribeToTireUpdates() {
  if (!window.supabaseUser) return;

  const subscription = window.supabase
    .channel('tire_updates')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tire_pressure_readings' }, (payload) => {
      console.log('New tire pressure reading:', payload.new);
      setTimeout(initTireTracker, 1000);
    })
    .subscribe();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      initTireTracker();
      subscribeToTireUpdates();
    }, 100);
  });
} else {
  setTimeout(() => {
    initTireTracker();
    subscribeToTireUpdates();
  }, 100);
}
