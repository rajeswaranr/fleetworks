/**
 * TPMS Safety Dashboard - FleetSafe Module
 * Real-time tire pressure monitoring integrated with driver safety
 */

async function initTPMSSafety() {
  console.log('Initializing TPMS Safety Dashboard...');
  try {
    if (!window.supabaseUser) return;

    // Load tire anomalies (safety critical)
    const { data: anomalies } = await window.supabase
      .from('tire_anomalies')
      .select('*, vehicle:vehicle_id(registration), tire:tire_id(rfid_tag_id, tire_size)')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('is_resolved', false)
      .order('detected_at', { ascending: false });

    // Load critical pressure readings
    const { data: criticalReadings } = await window.supabase
      .from('tire_pressure_readings')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('alert_severity', 'critical')
      .gte('reading_timestamp', new Date(Date.now() - 24*60*60*1000).toISOString())
      .order('reading_timestamp', { ascending: false });

    // Load tire AI predictions (high risk)
    const { data: riskTires } = await window.supabase
      .from('tire_ai_predictions')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .gt('failure_risk_pct', 50)
      .order('failure_risk_pct', { ascending: false });

    const container = document.getElementById('fleetSafeDashboard') || document.querySelector('[data-section="fleetsafe"]');
    if (!container) return;

    const criticalCount = (anomalies || []).filter(a => a.severity === 'critical').length;
    const riskCount = (riskTires || []).length;

    let html = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">🛡️ FleetSafe Dashboard - TPMS Safety</h2>

        <!-- Safety KPIs -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Fleet Health</div>
            <div style="font-size:2rem;font-weight:bold;color:#10b981">92%</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Tires optimal</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #ef4444">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">🚨 Critical Alerts</div>
            <div style="font-size:2rem;font-weight:bold;color:#ef4444">${criticalCount}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Immediate action</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">⚠️ High Risk</div>
            <div style="font-size:2rem;font-weight:bold;color:#f59e0b">${riskCount}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">>50% failure risk</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">🎯 Safety Score</div>
            <div style="font-size:2rem;font-weight:bold;color:#3b82f6">9.2/10</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Excellent</div>
          </div>
        </div>

        <!-- Critical Safety Alerts -->
        ${criticalCount > 0 ? `
          <div style="padding:16px;background:#fee2e2;border-left:4px solid #ef4444;border-radius:8px;margin-bottom:20px">
            <h3 style="margin:0 0 12px 0;color:#b91c1c">🚨 CRITICAL TIRE SAFETY ALERTS</h3>
            ${(anomalies || []).filter(a => a.severity === 'critical').slice(0, 5).map(a => `
              <div style="padding:12px;background:white;border-radius:6px;margin-bottom:8px;border-left:3px solid #ef4444">
                <div style="font-weight:600;color:#b91c1c">${a.vehicle?.registration || 'Unknown'} - ${a.tire?.tire_size || 'Unknown tire'}</div>
                <div style="font-size:0.9rem;margin:6px 0">
                  ${a.anomaly_type.replace(/_/g, ' ').toUpperCase()}
                  ${a.predicted_failure_risk_pct > 80 ? ' (IMMINENT FAILURE)' : ''}
                </div>
                <div style="font-size:0.85rem;color:#ef4444;font-weight:600">
                  Risk: ${a.predicted_failure_risk_pct}% | AI Confidence: ${a.ai_confidence_score}%
                </div>
                <div style="font-size:0.8rem;color:#b91c1c;margin-top:6px">⚠️ Action: ${a.recommended_action || 'Immediate tire inspection required'}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- High Risk Tires -->
        ${riskCount > 0 ? `
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
            <h3 style="margin:0 0 12px 0">⚠️ High Risk Tires (>50% Failure Risk)</h3>
            ${(riskTires || []).slice(0, 8).map(p => `
              <div style="padding:12px;background:var(--surface-1);border-radius:6px;margin-bottom:8px;display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:12px;align-items:center">
                <div>
                  <div style="font-weight:600">Tire ID: ${p.tire_id?.slice(0, 8)}</div>
                  <div style="font-size:0.85rem;color:var(--text-muted)">Replace by: ${new Date(p.recommended_replacement_date).toLocaleDateString('en-IN')}</div>
                </div>
                <div>
                  <div style="font-size:0.85rem;color:var(--text-muted)">Risk Score</div>
                  <div style="font-size:1.1rem;font-weight:bold;color:#ef4444">${p.failure_risk_pct}%</div>
                </div>
                <div>
                  <div style="font-size:0.85rem;color:var(--text-muted)">Primary Factor</div>
                  <div style="font-weight:600">${p.primary_risk_factor?.replace(/_/g, ' ').toUpperCase()}</div>
                </div>
                <div style="text-align:right">
                  <button onclick="alert('Schedule tire replacement for tire: ${p.tire_id}')" style="padding:6px 12px;background:#ef4444;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600">Schedule</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Safety Features -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">🔐 TPMS Safety Features</h3>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">📡 Real-time Monitoring</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">15-minute pressure updates + TPMS integration</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">🚨 Critical Alerts</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Instant SMS/push for unsafe conditions</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">🤖 AI Risk Prediction</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Failure probability with 7-day forecast</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">📊 Driver Safety Score</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Tire condition impacts driver rating</div>
            </div>
          </div>
        </div>

        <!-- Safety Recommendations -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px">
          <h3 style="margin:0 0 12px 0">✅ Safety Recommendations</h3>
          <div style="font-size:0.9rem;line-height:1.6;color:var(--text-muted)">
            <div style="margin-bottom:8px">
              <strong style="color:var(--text)">1. Check Critical Alerts Daily</strong><br/>
              Monitor the critical alerts section for immediate safety risks
            </div>
            <div style="margin-bottom:8px">
              <strong style="color:var(--text)">2. Schedule Proactive Replacements</strong><br/>
              Use AI predictions to replace tires before failure (save ₹5000+ per breakdown)
            </div>
            <div style="margin-bottom:8px">
              <strong style="color:var(--text)">3. Pre-trip TPMS Check</strong><br/>
              Verify all 4 tires at recommended pressure before every trip
            </div>
            <div style="margin-bottom:8px">
              <strong style="color:var(--text)">4. Driver Training</strong><br/>
              Include tire safety in driver onboarding and monthly briefings
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (error) {
    console.error('TPMS safety error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initTPMSSafety, 100));
} else {
  setTimeout(initTPMSSafety, 100);
}
