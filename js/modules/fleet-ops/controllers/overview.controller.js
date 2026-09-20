/**
 * FleetOps Overview Dashboard Controller
 * Displays vehicle status board, KPIs, and maintenance overview
 */

let overviewData = {
  vehicles: [],
  filters: { all: true, site: null, supervisor: null, driver: null }
};

/**
 * Initialize FleetOps Overview
 */
async function initOverviewDash() {
  console.log('Initializing FleetOps Overview...');

  try {
    if (!window.supabaseUser) {
      console.log('User not signed in');
      showOverviewPlaceholder();
      return;
    }

    // Load vehicles with related data
    const { data: vehicles, error: vError } = await window.supabase
      .from('vehicles')
      .select(`
        id, registration, vehicle_type, year_of_manufacture,
        driver:driver_id(name, phone),
        site_id, supervisor_id
      `)
      .eq('org_id', window.supabaseUser.org_id)
      .limit(100);

    if (vError) throw vError;
    overviewData.vehicles = vehicles || [];

    // Load vehicle telemetry for status
    const { data: telemetry } = await window.supabase
      .from('vehicle_telemetry')
      .select('vehicle_id, speed_kmh, timestamp')
      .in('vehicle_id', (vehicles || []).map(v => v.id))
      .order('timestamp', { ascending: false })
      .limit(100);

    // Match telemetry with vehicles
    if (telemetry) {
      const latestTelemetry = {};
      telemetry.forEach(t => {
        if (!latestTelemetry[t.vehicle_id]) latestTelemetry[t.vehicle_id] = t;
      });
      overviewData.vehicles = overviewData.vehicles.map(v => ({
        ...v,
        status: latestTelemetry[v.id]?.speed_kmh > 0 ? 'Running' : 'Idle',
        lastUpdate: latestTelemetry[v.id]?.timestamp
      }));
    }

    // Populate filter dropdowns
    populateFilterDropdowns();

    // Render dashboard
    renderOverviewDash();
  } catch (error) {
    console.error('Error loading overview:', error);
    showOverviewError(error.message);
  }
}

/**
 * Populate filter dropdowns
 */
function populateFilterDropdowns() {
  const vehicles = overviewData.vehicles;

  // Sites
  const sites = [...new Set(vehicles.map(v => v.site_id).filter(Boolean))];
  const siteSelect = document.getElementById('fltSite');
  if (siteSelect) {
    sites.forEach(site => {
      const option = document.createElement('option');
      option.value = site;
      option.textContent = `Site ${site.slice(0, 8)}`;
      siteSelect.appendChild(option);
    });
  }

  // Supervisors
  const supervisors = [...new Set(vehicles.map(v => v.supervisor_id).filter(Boolean))];
  const supSelect = document.getElementById('fltSupervisor');
  if (supSelect) {
    supervisors.forEach(sup => {
      const option = document.createElement('option');
      option.value = sup;
      option.textContent = `Supervisor ${sup.slice(0, 8)}`;
      supSelect.appendChild(option);
    });
  }

  // Drivers
  const drivers = [...new Set(vehicles.map(v => v.driver?.id).filter(Boolean))];
  const driverSelect = document.getElementById('fltDriver');
  if (driverSelect) {
    vehicles.forEach(v => {
      if (v.driver && !drivers.find(d => d === v.driver.id)) {
        drivers.push(v.driver.id);
      }
    });
    vehicles.forEach(v => {
      if (v.driver) {
        const option = document.createElement('option');
        option.value = v.driver.id;
        option.textContent = v.driver.name || `Driver ${v.driver.id.slice(0, 8)}`;
        if (!driverSelect.querySelector(`[value="${v.driver.id}"]`)) {
          driverSelect.appendChild(option);
        }
      }
    });
  }
}

/**
 * Set dashboard filter
 */
function setDashFilter(type, value = null) {
  overviewData.filters = { all: false, site: null, supervisor: null, driver: null };

  if (type === 'all') {
    overviewData.filters.all = true;
  } else {
    overviewData.filters[type] = value;
  }

  // Update UI
  document.getElementById('fltAll').classList.toggle('is-active', overviewData.filters.all);

  renderOverviewDash();
}

/**
 * Get filtered vehicles
 */
function getFilteredVehicles() {
  if (overviewData.filters.all) return overviewData.vehicles;

  return overviewData.vehicles.filter(v => {
    if (overviewData.filters.site && v.site_id !== overviewData.filters.site) return false;
    if (overviewData.filters.supervisor && v.supervisor_id !== overviewData.filters.supervisor) return false;
    if (overviewData.filters.driver && v.driver?.id !== overviewData.filters.driver) return false;
    return true;
  });
}

/**
 * Render overview dashboard
 */
function renderOverviewDash() {
  const filtered = getFilteredVehicles();
  document.getElementById('dashUpdated').textContent = `${filtered.length} vehicles`;

  renderOverviewVehicleStatusBoard(filtered);
  renderOpsStats(filtered);
}

/**
 * Render vehicle status board
 */
function renderOverviewVehicleStatusBoard(vehicles) {
  const container = document.getElementById('vehicleStatusBoard');
  if (!container) return;

  if (vehicles.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">No vehicles match filters</div>';
    return;
  }

  const html = vehicles.slice(0, 10).map(v => `
    <div style="display:grid;grid-template-columns:auto 1fr auto auto auto auto;gap:12px;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);align-items:center">
      <div style="width:40px;height:40px;background:linear-gradient(135deg,#3b82f6,#1e40af);border-radius:6px;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold">
        ${v.registration?.charAt(0) || '?'}
      </div>
      <div>
        <div style="font-weight:600;font-size:0.95rem">${v.registration || 'Unknown'}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">${v.driver?.name || 'No Driver'} • ${v.vehicle_type || 'Unknown'}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:0.85rem;color:var(--text-muted)">Status</div>
        <div style="font-weight:600;color:${v.status === 'Running' ? '#10b981' : '#6b7280'}">${v.status || 'Unknown'}</div>
      </div>
      <div style="text-align:right;min-width:60px">
        <div style="font-size:0.85rem;color:var(--text-muted)">Site</div>
        <div style="font-weight:500">${v.site_id ? v.site_id.slice(0, 6) : '—'}</div>
      </div>
      <div style="text-align:right;min-width:100px">
        <div style="font-size:0.85rem;color:var(--text-muted)">Last Update</div>
        <div style="font-size:0.85rem">${v.lastUpdate ? new Date(v.lastUpdate).toLocaleTimeString('en-IN') : '—'}</div>
      </div>
      <div>
        <button class="btn btn-primary btn-sm" onclick="alert('View details: ' + '${v.registration}')">→</button>
      </div>
    </div>
  `).join('');

  container.innerHTML = html;
}

/**
 * Render operations statistics
 */
function renderOpsStats(vehicles) {
  const container = document.getElementById('opsStatRow');
  if (!container) return;

  // Calculate stats
  const running = vehicles.filter(v => v.status === 'Running').length;
  const idle = vehicles.filter(v => v.status !== 'Running').length;

  const html = `
    <div class="stat-card">
      <div class="stat-label">Active Vehicles</div>
      <div class="stat-value">${running}</div>
      <div class="stat-unit">on road now</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Idle</div>
      <div class="stat-value">${idle}</div>
      <div class="stat-unit">parked</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Utilization</div>
      <div class="stat-value">${vehicles.length > 0 ? Math.round((running / vehicles.length) * 100) : 0}</div>
      <div class="stat-unit">%</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Fleet Total</div>
      <div class="stat-value">${vehicles.length}</div>
      <div class="stat-unit">vehicles</div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * Show placeholder
 */
function showOverviewPlaceholder() {
  document.getElementById('vehicleStatusBoard').innerHTML = `
    <div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
      <p style="font-size:0.9rem;margin-bottom:8px">📊 Sign in to view fleet overview</p>
      <p style="font-size:0.85rem">Track vehicle status, location, and utilization in real-time</p>
    </div>
  `;
}

/**
 * Show error
 */
function showOverviewError(message) {
  document.getElementById('vehicleStatusBoard').innerHTML = `
    <div style="padding:16px;background:#fee2e2;border-radius:8px;color:#b91c1c">
      <strong>Error loading overview:</strong> ${message}
    </div>
  `;
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => initOverviewDash(), 100);
  });
} else {
  setTimeout(() => initOverviewDash(), 100);
}
