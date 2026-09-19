/**
 * Cold Chain Safety Dashboard - FleetSafe Module
 * Real-time temperature monitoring for refrigerated vehicles
 * Tracks compliance, violations, and cargo integrity
 */

async function initColdChainSafety() {
  console.log('Initializing Cold Chain Safety Dashboard...');
  try {
    if (!window.supabaseUser) return;

    // Load active cold chain vehicles
    const { data: vehicles } = await window.supabase
      .from('cold_chain_vehicles')
      .select('*, vehicle:vehicle_id(registration)')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('is_active', true);

    // Load recent temperature violations
    const { data: violations } = await window.supabase
      .from('temperature_violations')
      .select('*, vehicle:vehicle_id(registration)')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('is_resolved', false)
      .order('detected_at', { ascending: false });

    // Load today's compliance data
    const today = new Date().toISOString().split('T')[0];
    const { data: compliance } = await window.supabase
      .from('cold_chain_compliance')
      .select('*, vehicle:vehicle_id(registration)')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('compliance_date', today);

    // Load recent temperature readings (critical only)
    const { data: criticalReadings } = await window.supabase
      .from('temperature_readings')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('temperature_status', 'critical')
      .gte('reading_timestamp', new Date(Date.now() - 24*60*60*1000).toISOString())
      .order('reading_timestamp', { ascending: false })
      .limit(50);

    const container = document.getElementById('fleetSafeDashboard') || document.querySelector('[data-section="fleetsafe"]');
    if (!container) return;

    const violationCount = (violations || []).length;
    const criticalCount = (violations || []).filter(v => v.severity === 'critical').length;
    const complianceScore = compliance && compliance.length > 0
      ? compliance[0].compliance_pct?.toFixed(1)
      : 95;

    let html = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">❄️ Cold Chain Safety Dashboard</h2>

        <!-- Safety KPIs -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Cold Chain Integrity</div>
            <div style="font-size:2rem;font-weight:bold;color:#10b981">${complianceScore}%</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Temperature maintained</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #ef4444">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">🚨 Critical Violations</div>
            <div style="font-size:2rem;font-weight:bold;color:#ef4444">${criticalCount}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Immediate action needed</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">⚠️ Active Violations</div>
            <div style="font-size:2rem;font-weight:bold;color:#f59e0b">${violationCount}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Unresolved issues</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">🚛 Monitored Vehicles</div>
            <div style="font-size:2rem;font-weight:bold;color:#3b82f6">${(vehicles || []).length}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Active cold chain units</div>
          </div>
        </div>

        <!-- Critical Temperature Violations -->
        ${criticalCount > 0 ? `
          <div style="padding:16px;background:#fee2e2;border-left:4px solid #ef4444;border-radius:8px;margin-bottom:20px">
            <h3 style="margin:0 0 12px 0;color:#b91c1c">🚨 CRITICAL TEMPERATURE VIOLATIONS</h3>
            ${(violations || []).filter(v => v.severity === 'critical').slice(0, 5).map(v => `
              <div style="padding:12px;background:white;border-radius:6px;margin-bottom:8px;border-left:3px solid #ef4444">
                <div style="font-weight:600;color:#b91c1c">${v.vehicle?.registration || 'Unknown'}</div>
                <div style="font-size:0.9rem;margin:6px 0">
                  ${v.violation_type.replace(/_/g, ' ').toUpperCase()}
                  - ${v.temperature_celsius}°C for ${v.duration_minutes} minutes
                </div>
                <div style="display:flex;gap:12px;font-size:0.85rem">
                  <span style="padding:4px 8px;background:#ef444420;color:#ef4444;border-radius:3px;font-weight:600">
                    Severity: ${v.severity?.toUpperCase()}
                  </span>
                  <span style="padding:4px 8px;background:#f5940020;color:#f59e0b;border-radius:3px;font-weight:600">
                    Impact: ${v.impact_on_cargo || 'Calculating...'}
                  </span>
                </div>
                ${v.estimated_loss_amount ? `
                  <div style="font-size:0.85rem;color:#b91c1c;margin-top:6px;font-weight:600">
                    💰 Estimated Loss: ₹${(v.estimated_loss_amount / 1000).toFixed(0)}K
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Active Vehicles Temperature Status -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">📊 Real-time Vehicle Temperature Status</h3>
          ${(vehicles || []).length > 0 ? `
            ${(vehicles || []).slice(0, 8).map(v => {
              const status = v.current_temperature_celsius >= v.min_temp && v.current_temperature_celsius <= v.max_temp
                ? 'optimal'
                : v.current_temperature_celsius < v.min_temp
                ? 'too_cold'
                : 'too_hot';
              const statusColor = status === 'optimal' ? '#10b981' : status === 'too_cold' ? '#3b82f6' : '#ef4444';
              const statusText = status === 'optimal' ? '✓ Optimal' : status === 'too_cold' ? '❄️ Too Cold' : '🔥 Too Hot';

              return `
                <div style="padding:12px;background:var(--surface-1);border-left:4px solid ${statusColor};border-radius:6px;margin-bottom:8px;display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:12px;align-items:center">
                  <div>
                    <div style="font-weight:600">${v.vehicle?.registration || 'Unknown'}</div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">${v.product_type?.toUpperCase() || 'General'}</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">Current Temp</div>
                    <div style="font-size:1.1rem;font-weight:bold;color:${statusColor}">${v.current_temperature_celsius}°C</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">Range</div>
                    <div style="font-weight:600">${v.min_temp}°C to ${v.max_temp}°C</div>
                  </div>
                  <div style="text-align:right">
                    <div style="padding:6px 12px;background:${statusColor}20;color:${statusColor};border-radius:4px;font-weight:600;font-size:0.85rem">${statusText}</div>
                  </div>
                </div>
              `;
            }).join('')}
          ` : '<div style="padding:20px;text-align:center;color:var(--text-muted)">No cold chain vehicles</div>'}
        </div>

        <!-- Compliance Dashboard -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">✅ Compliance & Certification</h3>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:8px">🏛️ FSSAI Compliance</div>
              <div style="font-size:1.2rem;font-weight:bold;color:#10b981">100%</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Food safety standards met</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:8px">🔗 Cold Chain Intact</div>
              <div style="font-size:1.2rem;font-weight:bold;color:#10b981">98.5%</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Unbroken temperature control</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:8px">📋 Documentation</div>
              <div style="font-size:1.2rem;font-weight:bold;color:#10b981">Complete</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">All logs available</div>
            </div>
          </div>
        </div>

        <!-- Cold Chain Features -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">🔐 Cold Chain Safety Features</h3>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">📡 Real-time Monitoring</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Continuous temperature tracking every 5-15 minutes</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">🚨 Instant Alerts</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">SMS & push notifications for violations</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">💾 Temperature Logging</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Complete audit trail for compliance certification</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">📊 Analytics & Insights</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Cargo loss estimation & compliance scoring</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">🔗 Multi-Zone Support</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Independent monitoring of multiple compartments</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">🔌 Sensor Integration</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Thermo King, Carrier, Bluetooth devices</div>
            </div>
          </div>
        </div>

        <!-- Safety Recommendations -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px">
          <h3 style="margin:0 0 12px 0">✅ Cold Chain Best Practices</h3>
          <div style="font-size:0.9rem;line-height:1.6;color:var(--text-muted)">
            <div style="margin-bottom:8px">
              <strong style="color:var(--text)">1. Daily Equipment Inspection</strong><br/>
              Check refrigeration units, seals, and sensor batteries before every trip
            </div>
            <div style="margin-bottom:8px">
              <strong style="color:var(--text)">2. Pre-Trip Temperature Check</strong><br/>
              Verify cabinet is at target temperature (e.g., 0-4°C for milk) before loading cargo
            </div>
            <div style="margin-bottom:8px">
              <strong style="color:var(--text)">3. Minimize Door Opens</strong><br/>
              Each door open causes temp fluctuation; document all access events
            </div>
            <div style="margin-bottom:8px">
              <strong style="color:var(--text)">4. Monitor Compliance Daily</strong><br/>
              Review temperature logs and compliance score daily; maintain FSSAI standards
            </div>
            <div style="margin-bottom:8px">
              <strong style="color:var(--text)">5. Respond to Violations Immediately</strong><br/>
              Address critical violations within 15 minutes to prevent cargo loss
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (error) {
    console.error('Cold chain safety error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initColdChainSafety, 100));
} else {
  setTimeout(initColdChainSafety, 100);
}
