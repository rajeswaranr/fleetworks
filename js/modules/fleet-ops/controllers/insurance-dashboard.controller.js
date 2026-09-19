/**
 * Insurance Dashboard Controller
 * Tracks policies, claims, coverage, and expiry alerts
 */

let insuranceData = {
  policies: [],
  claims: [],
  coverage: []
};

async function initInsuranceDash() {
  console.log('Initializing Insurance Dashboard...');
  try {
    if (!window.supabaseUser) {
      showInsurancePlaceholder();
      return;
    }

    // Load insurance policies
    const { data: policies } = await window.supabase
      .from('insurance_policies')
      .select('*, vehicle:vehicle_id(registration)')
      .eq('org_id', window.supabaseUser.org_id)
      .order('expiry_date', { ascending: true });

    // Load claims
    const { data: claims } = await window.supabase
      .from('insurance_claims')
      .select('*, vehicle:vehicle_id(registration)')
      .eq('org_id', window.supabaseUser.org_id)
      .order('claim_date', { ascending: false });

    insuranceData.policies = policies || [];
    insuranceData.claims = claims || [];

    renderInsuranceDash();
  } catch (error) {
    console.error('Insurance dashboard error:', error);
    showInsuranceError(error.message);
  }
}

function renderInsuranceDash() {
  const policies = insuranceData.policies;
  const claims = insuranceData.claims;

  // Calculate stats
  const now = new Date();
  const expiringSoon = policies.filter(p => {
    const exp = new Date(p.expiry_date);
    const daysUntil = (exp - now) / (1000 * 60 * 60 * 24);
    return daysUntil <= 30 && daysUntil > 0;
  }).length;

  const expired = policies.filter(p => new Date(p.expiry_date) < now).length;
  const activeClaims = claims.filter(c => c.status === 'pending').length;

  // Render stats
  const statsHtml = `
    <div class="stat-card">
      <div class="stat-label">Active Policies</div>
      <div class="stat-value">${policies.length}</div>
      <div class="stat-unit">coverage active</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Expiring Soon</div>
      <div class="stat-value" style="color:#f59e0b">${expiringSoon}</div>
      <div class="stat-unit">next 30 days</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Expired</div>
      <div class="stat-value" style="color:#ef4444">${expired}</div>
      <div class="stat-unit">need renewal</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Active Claims</div>
      <div class="stat-value">${activeClaims}</div>
      <div class="stat-unit">pending settlement</div>
    </div>
  `;

  const statsContainer = document.getElementById('insureStats');
  if (statsContainer) statsContainer.innerHTML = statsHtml;

  // Render policies table
  renderPoliciesTable(policies);

  // Render claims
  renderClaimsTable(claims);
}

function renderPoliciesTable(policies) {
  const container = document.getElementById('insurePolicies');
  if (!container || policies.length === 0) {
    if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No policies</div>';
    return;
  }

  const html = policies.slice(0, 10).map(p => {
    const expDate = new Date(p.expiry_date);
    const now = new Date();
    const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
    const statusColor = daysLeft < 0 ? '#ef4444' : daysLeft <= 30 ? '#f59e0b' : '#10b981';
    const statusText = daysLeft < 0 ? 'EXPIRED' : daysLeft <= 30 ? 'EXPIRING' : 'ACTIVE';

    return `
      <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:center">
        <div>
          <div style="font-weight:600">${p.policy_number}</div>
          <div style="font-size:0.85rem;color:var(--text-muted)">${p.vehicle?.registration || 'Unknown'} • ${p.insurance_provider}</div>
        </div>
        <div>
          <div style="font-size:0.85rem;color:var(--text-muted)">Expiry</div>
          <div style="font-weight:600">${new Date(p.expiry_date).toLocaleDateString('en-IN')}</div>
        </div>
        <div>
          <div style="font-size:0.85rem;color:var(--text-muted)">Coverage</div>
          <div style="font-weight:600">₹${(p.coverage_amount || 0).toLocaleString('en-IN')}</div>
        </div>
        <div style="text-align:right">
          <div style="padding:4px 8px;background:${statusColor}20;color:${statusColor};border-radius:4px;font-size:0.8rem;font-weight:bold">${statusText}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function renderClaimsTable(claims) {
  const container = document.getElementById('insureClaims');
  if (!container || claims.length === 0) {
    if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No claims</div>';
    return;
  }

  const html = claims.slice(0, 8).map(c => {
    const statusColors = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444', settled: '#3b82f6' };
    return `
      <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div>
          <div style="font-weight:600">${c.claim_number}</div>
          <div style="font-size:0.85rem;color:var(--text-muted)">${c.vehicle?.registration || 'Unknown'}</div>
        </div>
        <div>
          <div style="font-size:0.85rem;color:var(--text-muted)">Amount</div>
          <div style="font-weight:600">₹${(c.claim_amount || 0).toLocaleString('en-IN')}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:0.85rem;color:var(--text-muted)">${new Date(c.claim_date).toLocaleDateString('en-IN')}</div>
          <div style="padding:4px 8px;background:${statusColors[c.status] || '#666'}20;color:${statusColors[c.status] || '#666'};border-radius:4px;font-size:0.8rem;font-weight:bold">${c.status?.toUpperCase()}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function showInsurancePlaceholder() {
  const container = document.getElementById('insurePolicies');
  if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Sign in to view insurance policies</div>';
}

function showInsuranceError(message) {
  const container = document.getElementById('insurePolicies');
  if (container) container.innerHTML = `<div style="padding:16px;background:#fee2e2;border-radius:8px;color:#b91c1c">Error: ${message}</div>`;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => initInsuranceDash(), 100));
} else {
  setTimeout(() => initInsuranceDash(), 100);
}
