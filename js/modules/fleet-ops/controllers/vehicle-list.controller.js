/**
 * Vehicle List Controller - RTO Compliance Tracking
 */
async function initVehicleList() {
  try {
    if (!window.supabaseUser) return;
    const { data: vehicles } = await window.supabase
      .from('vehicles')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id);

    const container = document.getElementById('vehicleListContainer') || document.querySelector('#tab-vehicles');
    if (!container) return;

    const html = (vehicles || []).slice(0, 20).map(v => `
      <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);margin-bottom:8px;display:grid;grid-template-columns:1fr auto;gap:12px">
        <div>
          <div style="font-weight:600">${v.registration}</div>
          <div style="font-size:0.85rem;color:var(--text-muted)">${v.vehicle_type} • ${v.year_of_manufacture}</div>
        </div>
        <div style="text-align:right">
          <button class="btn btn-primary btn-sm" onclick="alert('View: ${v.registration}')">View</button>
        </div>
      </div>
    `).join('');

    container.innerHTML = `<div style="padding:16px">${html || 'No vehicles'}</div>`;
  } catch (error) {
    console.error('Vehicle list error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initVehicleList, 100));
} else {
  setTimeout(initVehicleList, 100);
}
