/**
 * FleetInsure Dashboard
 * Insurance policy management, claims tracking, compliance monitoring
 */

async function initFleetInsureDashboard() {
  console.log('Initializing FleetInsure Dashboard...');
  if (!window.supabaseUser) return;

  try {
    // Insurance metrics: Policies, claims, coverage
    const { data: policies } = await window.supabase
      .from('insurance_policies')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id);

    const { data: claims } = await window.supabase
      .from('insurance_claims')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id);

    const now = new Date();
    const expiringSoon = (policies || []).filter(p => {
      const exp = new Date(p.expiry_date);
      const daysLeft = (exp - now) / (1000 * 60 * 60 * 24);
      return daysLeft <= 30 && daysLeft > 0;
    }).length;

    const activeClaims = (claims || []).filter(c => c.status === 'pending').length;
    const totalCoverageAmount = (policies || []).reduce((sum, p) => sum + (p.coverage_amount || 0), 0);

    const dashboard = document.getElementById('fleetInsureDashboard') || document.querySelector('[data-section="fleetinsure"]');
    if (!dashboard) return;

    dashboard.innerHTML = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">🛡️ FleetInsure Dashboard</h2>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Active Policies</div>
            <div style="font-size:2rem;font-weight:bold">${policies?.length || 0}</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Expiring Soon</div>
            <div style="font-size:2rem;font-weight:bold">${expiringSoon}</div>
            <div style="font-size:0.8rem;color:#f59e0b">Next 30 days</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Active Claims</div>
            <div style="font-size:2rem;font-weight:bold">${activeClaims}</div>
            <div style="font-size:0.8rem;color:#3b82f6">Pending settlement</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #8b5cf6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Total Coverage</div>
            <div style="font-size:2rem;font-weight:bold">₹${(totalCoverageAmount / 100000).toFixed(1)}L</div>
          </div>
        </div>

        <div style="padding:16px;background:var(--surface-2);border-radius:8px">
          <h3 style="margin:0 0 12px 0">FleetInsure Features</h3>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">📋 Policy Management</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Track all insurance policies with expiry alerts</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">📢 Claims Tracking</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">End-to-end claims management and settlement</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">✅ Compliance</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">RTA, fitness, permit compliance dashboard</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <div style="font-weight:600;margin-bottom:4px">📊 Coverage Analysis</div>
              <div style="font-size:0.85rem;color:var(--text-muted)">Insurance adequacy and gap analysis</div>
            </div>
          </div>
        </div>

        <div style="margin-top:16px;padding:12px;background:#fef3c720;border-left:4px solid #f59e0b;border-radius:6px">
          <div style="font-weight:600;color:#78350f;margin-bottom:4px">⚠️ Action Required</div>
          <div style="font-size:0.85rem;color:#78350f">${expiringSoon} policies expiring in the next 30 days. Review and renew immediately.</div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('FleetInsure error:', error);
  }
}

setTimeout(initFleetInsureDashboard, 100);
