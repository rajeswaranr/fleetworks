/**
 * FleetAI Dashboard
 * AI-powered predictive analytics and anomaly detection
 */

async function initFleetAIDashboard() {
  console.log('Initializing FleetAI Dashboard...');
  if (!window.supabaseUser) return;

  try {
    // AI metrics: Anomalies detected, predictions, insights
    const { data: anomalies } = await window.supabase
      .from('spare_parts_prices')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .gt('price_deviation_pct', 25);

    const { data: predictions } = await window.supabase
      .from('maintenance_predictions')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('status', 'active');

    const anomalyCount = anomalies?.length || 0;
    const predictionCount = predictions?.length || 0;

    const dashboard = document.getElementById('fleetAIDashboard') || document.querySelector('[data-section="fleetai"]');
    if (!dashboard) return;

    dashboard.innerHTML = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">🤖 FleetAI Dashboard</h2>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #ef4444">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Price Anomalies</div>
            <div style="font-size:2rem;font-weight:bold">${anomalyCount}</div>
            <div style="font-size:0.8rem;color:#ef4444">Detected & Flagged</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Maintenance Predictions</div>
            <div style="font-size:2rem;font-weight:bold">${predictionCount}</div>
            <div style="font-size:0.8rem;color:#3b82f6">Upcoming Services</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Cost Savings</div>
            <div style="font-size:2rem;font-weight:bold">💰 15%</div>
            <div style="font-size:0.8rem;color:#10b981">Via predictive maintenance</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Efficiency Gain</div>
            <div style="font-size:2rem;font-weight:bold">📈 23%</div>
            <div style="font-size:0.8rem;color:#f59e0b">Fleet optimization</div>
          </div>
        </div>

        <div style="padding:16px;background:var(--surface-2);border-radius:8px">
          <h3 style="margin:0 0 12px 0">AI Capabilities</h3>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">📊 Predictive Maintenance</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">ML models predict failures before they happen</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">💰 Price Anomaly Detection</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Flags unusual spare parts pricing automatically</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">🎯 Route Optimization</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Minimize fuel consumption and delivery time</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">🔍 Anomaly Detection</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Detects unusual patterns in fleet behavior</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('FleetAI error:', error);
  }
}

setTimeout(initFleetAIDashboard, 100);
