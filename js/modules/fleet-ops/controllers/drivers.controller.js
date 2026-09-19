/**
 * Drivers Controller
 * Manages driver profiles, licenses, ratings, and vehicle assignments
 */

let driversData = {
  drivers: [],
  stats: { total: 0, active: 0, licenseExpiring: 0, avgRating: 0 }
};

async function initDrivers() {
  console.log('Initializing Drivers Management...');
  try {
    if (!window.supabaseUser) return;

    const { data: drivers } = await window.supabase
      .from('drivers')
      .select('*, assigned_vehicles:vehicle_id(registration), license_details:licenses(*)')
      .eq('org_id', window.supabaseUser.org_id)
      .order('name');

    driversData.drivers = drivers || [];
    calculateDriverStats();
    renderDrivers();
  } catch (error) {
    console.error('Drivers controller error:', error);
  }
}

function calculateDriverStats() {
  const now = new Date();
  const expiringDates = driversData.drivers
    .filter(d => d.license_details?.length > 0)
    .map(d => d.license_details[0].expiry_date)
    .filter(date => {
      const exp = new Date(date);
      const daysLeft = (exp - now) / (1000 * 60 * 60 * 24);
      return daysLeft <= 30 && daysLeft > 0;
    });

  driversData.stats = {
    total: driversData.drivers.length,
    active: driversData.drivers.filter(d => d.status === 'active').length,
    licenseExpiring: expiringDates.length,
    avgRating: driversData.drivers.length > 0
      ? (driversData.drivers.reduce((sum, d) => sum + (d.safety_rating || 0), 0) / driversData.drivers.length).toFixed(1)
      : 0
  };
}

function renderDrivers() {
  const container = document.querySelector('#tab-drivers') || document.getElementById('driversContainer');
  if (!container) return;

  const stats = driversData.stats;
  let html = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold">${stats.total}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Total Drivers</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#10b981">${stats.active}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Active</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#f59e0b">${stats.licenseExpiring}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">License Expiring</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#3b82f6">${stats.avgRating}/5</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Avg Rating</div>
      </div>
    </div>
  `;

  // Drivers list
  html += driversData.drivers.map(d => {
    const license = d.license_details?.length > 0 ? d.license_details[0] : null;
    const licenseExpiry = license ? new Date(license.expiry_date) : null;
    const now = new Date();
    const daysUntilExpiry = licenseExpiry ? Math.ceil((licenseExpiry - now) / (1000 * 60 * 60 * 24)) : null;
    const licenseStatus = !licenseExpiry
      ? 'No License'
      : daysUntilExpiry < 0
      ? 'EXPIRED'
      : daysUntilExpiry <= 30
      ? 'EXPIRING'
      : 'VALID';

    const licenseColor = licenseStatus === 'EXPIRED' ? '#ef4444' : licenseStatus === 'EXPIRING' ? '#f59e0b' : '#10b981';
    const ratingColor = d.safety_rating >= 4.5 ? '#10b981' : d.safety_rating >= 3 ? '#f59e0b' : '#ef4444';

    return `
      <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <div style="font-weight:600">${d.name}</div>
            <div style="font-size:0.85rem;color:var(--text-muted)">${d.phone || 'N/A'} • License: ${license?.license_number || 'N/A'}</div>
          </div>
          <div style="display:flex;gap:8px">
            <div style="padding:4px 8px;background:${licenseColor}20;color:${licenseColor};border-radius:4px;font-size:0.8rem;font-weight:bold">${licenseStatus}</div>
            <div style="padding:4px 8px;background:${ratingColor}20;color:${ratingColor};border-radius:4px;font-size:0.8rem;font-weight:bold">⭐ ${d.safety_rating || 0}/5</div>
          </div>
        </div>
        <div style="font-size:0.85rem;color:var(--text-muted)">
          Documents: ${license?.document_url ? '✓ Verified' : 'Pending'} •
          Status: <span style="font-weight:600;color:${d.status === 'active' ? '#10b981' : '#ef4444'}">${d.status?.toUpperCase()}</span>
        </div>
      </div>
    `;
  }).join('') || '<div style="text-align:center;padding:20px;color:var(--text-muted)">No drivers</div>';

  container.innerHTML = html;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initDrivers, 100));
} else {
  setTimeout(initDrivers, 100);
}
