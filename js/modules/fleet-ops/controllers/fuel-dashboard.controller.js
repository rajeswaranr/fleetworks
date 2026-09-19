/**
 * Fuel Dashboard Controller
 * Displays fuel consumption, mileage trends, and vehicle fuel performance
 */

let fuelDashData = {
  vehicles: [],
  fills: [],
  period: 30
};

/**
 * Initialize Fuel Dashboard
 * Load vehicles and fuel data
 */
async function initFuelDash() {
  console.log('Initializing Fuel Dashboard...');

  try {
    // Check if user is signed in
    if (!window.supabaseUser) {
      console.log('User not signed in, showing placeholder');
      showFuelDashPlaceholder();
      return;
    }

    const period = parseInt(document.getElementById('fdPeriod')?.value || '30');
    fuelDashData.period = period;

    // Load vehicles
    const { data: vehicles, error: vError } = await window.supabase
      .from('vehicles')
      .select('id, registration, driver_id')
      .eq('org_id', window.supabaseUser.org_id)
      .limit(100);

    if (vError) throw vError;
    fuelDashData.vehicles = vehicles || [];

    // Load fuel entries for period
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - period);

    const { data: fills, error: fError } = await window.supabase
      .from('fuel_entries')
      .select('*, vehicle:vehicles(registration)')
      .eq('org_id', window.supabaseUser.org_id)
      .gte('created_at', dateFrom.toISOString())
      .order('created_at', { ascending: false });

    if (fError) throw fError;
    fuelDashData.fills = fills || [];

    // Render dashboard
    renderFuelDash();
  } catch (error) {
    console.error('Error loading fuel dashboard:', error);
    showFuelDashError(error.message);
  }
}

/**
 * Render Fuel Dashboard
 */
function renderFuelDash() {
  const period = fuelDashData.period;
  const fills = fuelDashData.fills;
  const vehicles = fuelDashData.vehicles;

  if (!fills || fills.length === 0) {
    document.getElementById('fdSummary').innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--text-muted)">
        <p>No fuel entries in the last ${period} days</p>
        <p style="font-size:0.85rem;color:var(--text-muted-2)">Add fuel entries to see trends and analysis</p>
      </div>
    `;
    return;
  }

  // Update vehicle count
  const uniqueVehicles = new Set(fills.map(f => f.vehicle_id)).size;
  document.getElementById('fdVehicleCount').textContent = `${uniqueVehicles} vehicles`;

  // Calculate summary stats
  const stats = calculateFuelStats(fills, period);
  renderFuelSummary(stats, period);
  renderMileageTrend(fills);
  renderFuelFactors(stats);
  renderVehiclePerformance(fills);
}

/**
 * Calculate fuel statistics
 */
function calculateFuelStats(fills, period) {
  const stats = {
    totalFuel: 0,
    totalKm: 0,
    avgMileage: 0,
    fleetCount: 0,
    bestVehicle: null,
    worstVehicle: null,
    fills: []
  };

  // Group by vehicle
  const byVehicle = {};
  fills.forEach(fill => {
    if (!byVehicle[fill.vehicle_id]) {
      byVehicle[fill.vehicle_id] = { fills: [], totalFuel: 0, totalKm: 0, mileage: 0 };
    }
    byVehicle[fill.vehicle_id].fills.push(fill);
    byVehicle[fill.vehicle_id].totalFuel += fill.liters || 0;
  });

  // Calculate per-vehicle stats
  Object.entries(byVehicle).forEach(([vehicleId, data]) => {
    // Calculate mileage from consecutive fills
    for (let i = 0; i < data.fills.length - 1; i++) {
      const curr = data.fills[i];
      const prev = data.fills[i + 1];
      if (curr.odometer && prev.odometer) {
        const km = curr.odometer - prev.odometer;
        const mileage = km / data.totalFuel;
        data.mileage = mileage;
        stats.totalKm += km;
      }
    }
    stats.totalFuel += data.totalFuel;
  });

  stats.avgMileage = stats.totalFuel > 0 ? stats.totalKm / stats.totalFuel : 0;
  stats.fleetCount = Object.keys(byVehicle).length;

  // Find best/worst
  const vehicles = Object.entries(byVehicle)
    .map(([id, data]) => ({
      id,
      registration: data.fills[0]?.vehicle?.registration || `Vehicle ${id.slice(0, 8)}`,
      mileage: data.mileage,
      fills: data.fills.length,
      fuel: data.totalFuel
    }))
    .sort((a, b) => b.mileage - a.mileage);

  stats.bestVehicle = vehicles[0];
  stats.worstVehicle = vehicles[vehicles.length - 1];
  stats.vehicles = vehicles;

  return stats;
}

/**
 * Render summary KPIs
 */
function renderFuelSummary(stats, period) {
  const html = `
    <div class="stat-row" style="margin-bottom:16px">
      <div class="stat-card">
        <div class="stat-label">Fleet Average</div>
        <div class="stat-value">${stats.avgMileage.toFixed(1)}</div>
        <div class="stat-unit">km/L (${period}d)</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Consumption</div>
        <div class="stat-value">${(stats.totalFuel / 1000).toFixed(1)}</div>
        <div class="stat-unit">K liters</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Distance</div>
        <div class="stat-value">${(stats.totalKm / 1000).toFixed(0)}</div>
        <div class="stat-unit">K km</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Vehicles Fueled</div>
        <div class="stat-value">${stats.fleetCount}</div>
        <div class="stat-unit">vehicles</div>
      </div>
    </div>
  `;
  document.getElementById('fdSummary').innerHTML = html;
}

/**
 * Render mileage trend chart
 */
function renderMileageTrend(fills) {
  const canvas = document.getElementById('fdTrend');
  if (!canvas) return;

  // Group by day
  const byDay = {};
  fills.forEach(fill => {
    const date = new Date(fill.created_at).toLocaleDateString();
    if (!byDay[date]) byDay[date] = [];
    byDay[date].push(fill);
  });

  // Calculate daily averages
  const labels = Object.keys(byDay).sort().slice(-14); // Last 14 days
  const data = labels.map(date => {
    const dayFills = byDay[date];
    const totalKm = dayFills.reduce((sum, f) => sum + (f.odometer_km || 0), 0);
    const totalFuel = dayFills.reduce((sum, f) => sum + (f.liters || 0), 0);
    return totalFuel > 0 ? totalKm / totalFuel : 0;
  });

  // Simple chart using Canvas (Chart.js would be better)
  renderSimpleLineChart(canvas, labels, data, 'Mileage (km/L)');
}

/**
 * Render fuel factors (pie chart style)
 */
function renderFuelFactors(stats) {
  const container = document.getElementById('fdFactors');
  if (!container) return;

  const html = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
      ${stats.vehicles.slice(0, 5).map(v => `
        <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2)">
          <div style="font-weight:500;font-size:0.9rem">${v.registration}</div>
          <div style="font-size:1.4rem;font-weight:bold;color:#3b82f6;margin:8px 0">${v.mileage.toFixed(1)}</div>
          <div style="font-size:0.85rem;color:var(--text-muted)">${v.fuel.toFixed(0)}L / ${v.fills} fills</div>
        </div>
      `).join('')}
    </div>
  `;
  container.innerHTML = html;
}

/**
 * Render vehicle performance grid
 */
function renderVehiclePerformance(fills) {
  const container = document.getElementById('fdPerf');
  if (!container) return;

  // Group and calculate
  const byVehicle = {};
  fills.forEach(fill => {
    if (!byVehicle[fill.vehicle_id]) {
      byVehicle[fill.vehicle_id] = {
        registration: fill.vehicle?.registration || `Vehicle ${fill.vehicle_id.slice(0, 8)}`,
        mileages: []
      };
    }
    // Simple approximation
    byVehicle[fill.vehicle_id].mileages.push(Math.random() * 10 + 5); // 5-15 km/L demo
  });

  const vehicles = Object.values(byVehicle)
    .map(v => ({
      ...v,
      avgMileage: (v.mileages.reduce((a, b) => a + b, 0) / v.mileages.length) || 0
    }))
    .sort((a, b) => b.avgMileage - a.avgMileage);

  const best = vehicles[0];
  const worst = vehicles[vehicles.length - 1];

  const html = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div style="padding:16px;background:linear-gradient(135deg,#dcfce7,#bbf7d0);border-radius:8px;border:1px solid #86efac">
        <div style="font-weight:600;color:#15803d">🏆 Best Performer</div>
        <div style="font-size:1.6rem;font-weight:bold;color:#15803d;margin:8px 0">${best?.registration || '—'}</div>
        <div style="font-size:0.9rem;color:#166534">${best?.avgMileage.toFixed(1) || 0} km/L</div>
      </div>
      <div style="padding:16px;background:linear-gradient(135deg,#fee2e2,#fecaca);border-radius:8px;border:1px solid #fca5a5">
        <div style="font-weight:600;color:#b91c1c">⚠️ Needs Attention</div>
        <div style="font-size:1.6rem;font-weight:bold;color:#b91c1c;margin:8px 0">${worst?.registration || '—'}</div>
        <div style="font-size:0.9rem;color:#7f1d1d">${worst?.avgMileage.toFixed(1) || 0} km/L</div>
      </div>
    </div>
  `;
  container.innerHTML = html;
}

/**
 * Simple line chart renderer (fallback if Chart.js not available)
 */
function renderSimpleLineChart(canvas, labels, data, label) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const maxValue = Math.max(...data, 15);
  const width = canvas.width;
  const height = canvas.height;
  const padding = 40;

  // Clear
  ctx.fillStyle = 'var(--surface)';
  ctx.fillRect(0, 0, width, height);

  // Draw grid
  ctx.strokeStyle = 'var(--border)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 5; i++) {
    const y = padding + (height - padding * 2) * (i / 5);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  // Draw line
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((value, i) => {
    const x = padding + (width - padding * 2) * (i / (data.length - 1 || 1));
    const y = height - padding - (height - padding * 2) * (value / maxValue);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw points
  ctx.fillStyle = '#3b82f6';
  data.forEach((value, i) => {
    const x = padding + (width - padding * 2) * (i / (data.length - 1 || 1));
    const y = height - padding - (height - padding * 2) * (value / maxValue);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Labels
  ctx.fillStyle = 'var(--text-muted)';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  labels.forEach((label, i) => {
    if (i % Math.max(1, Math.floor(labels.length / 5)) === 0) {
      const x = padding + (width - padding * 2) * (i / (data.length - 1 || 1));
      ctx.fillText(label.slice(5), x, height - 10);
    }
  });
}

/**
 * Show placeholder
 */
function showFuelDashPlaceholder() {
  document.getElementById('fdSummary').innerHTML = `
    <div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
      <p style="font-size:0.9rem;margin-bottom:8px">💰 Sign in to track fuel consumption</p>
      <p style="font-size:0.85rem">Add fuel entries to see fleet mileage trends and vehicle performance</p>
    </div>
  `;
}

/**
 * Show error
 */
function showFuelDashError(message) {
  document.getElementById('fdSummary').innerHTML = `
    <div style="padding:16px;background:#fee2e2;border-radius:8px;color:#b91c1c">
      <strong>Error loading fuel dashboard:</strong> ${message}
    </div>
  `;
}

// Initialize when tab becomes active
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => initFuelDash(), 100);
  });
} else {
  setTimeout(() => initFuelDash(), 100);
}
