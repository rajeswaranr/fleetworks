/**
 * Demo Dashboard Controller
 * Live simulation of vehicle tracking, fuel, tire pressure, and video feeds
 */

async function initDemoDashboard() {
  console.log('Initializing Demo Dashboard...');

  const container = document.getElementById('demoDashboardContainer') || document.querySelector('[data-section="demo"]');
  if (!container) return;

  let selectedVehicleId = null;

  const html = `
    <div style="padding:20px">
      <h2 style="margin:0 0 20px 0">🚗 Live Fleet Simulator Demo</h2>

      <!-- Vehicle Selection -->
      <div style="margin-bottom:20px;display:flex;gap:12px;flex-wrap:wrap">
        ${window.VehicleSimulator?.vehicles?.map(v => `
          <button class="vehicle-btn" data-id="${v.id}" style="
            padding:10px 16px;
            background:#f1f5f9;
            border:2px solid transparent;
            border-radius:6px;
            cursor:pointer;
            font-weight:600;
            transition:all 0.2s;
          ">
            ${v.name} (${v.driver})
          </button>
        `).join('') || '<p>Loading vehicles...</p>'}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <!-- GPS Map Section -->
        <div style="background:var(--surface-2);border-radius:12px;overflow:hidden;min-height:400px">
          <div id="gpsMapContainer" style="
            width:100%;
            height:100%;
            background:linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%);
            position:relative;
            display:flex;
            align-items:center;
            justify-content:center;
          ">
            <div style="text-align:center;pointer-events:none">
              <div style="font-size:3rem;margin-bottom:12px">🗺️</div>
              <h3 style="margin:0;color:#0f1e33">Real-time GPS Map</h3>
              <p style="margin:8px 0 0;color:#64748b;font-size:0.9rem">Vehicle locations updating every second</p>
              <div id="vehicleLocations" style="margin-top:16px;font-size:0.85rem;color:#1e293b;pointer-events:auto"></div>
            </div>
          </div>
        </div>

        <!-- Video Feeds Section -->
        <div style="background:var(--surface-2);border-radius:12px;overflow:hidden">
          <div style="padding:16px;border-bottom:1px solid var(--border)">
            <h3 style="margin:0">📹 Video Feeds</h3>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:16px">
            <!-- 360 Camera -->
            <div style="
              background:linear-gradient(135deg, #1f2937 0%, #111827 100%);
              border-radius:8px;
              aspect-ratio:1;
              display:flex;
              align-items:center;
              justify-content:center;
              color:white;
              position:relative;
              overflow:hidden;
            ">
              <div style="
                position:absolute;
                top:0;
                left:0;
                width:100%;
                height:100%;
                background:radial-gradient(circle at 30% 30%, rgba(0,217,255,0.2), transparent);
              "></div>
              <div style="text-align:center;position:relative;z-index:1">
                <div style="font-size:2rem;margin-bottom:8px">📷</div>
                <div style="font-weight:600;font-size:0.9rem">360° Camera</div>
                <div style="font-size:0.8rem;opacity:0.7;margin-top:4px">LIVE</div>
              </div>
            </div>

            <!-- Dashcam -->
            <div style="
              background:linear-gradient(135deg, #1f2937 0%, #111827 100%);
              border-radius:8px;
              aspect-ratio:1;
              display:flex;
              align-items:center;
              justify-content:center;
              color:white;
              position:relative;
              overflow:hidden;
            ">
              <div style="
                position:absolute;
                top:0;
                left:0;
                width:100%;
                height:100%;
                background:radial-gradient(circle at 70% 70%, rgba(255, 107, 107, 0.2), transparent);
              "></div>
              <div style="text-align:center;position:relative;z-index:1">
                <div style="font-size:2rem;margin-bottom:8px">🎥</div>
                <div style="font-weight:600;font-size:0.9rem">Dashcam</div>
                <div style="font-size:0.8rem;opacity:0.7;margin-top:4px">LIVE</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Real-time Monitoring Section -->
      <div id="monitoringSection" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px">
        <!-- Fuel Monitoring -->
        <div style="background:var(--surface-2);padding:20px;border-radius:12px">
          <h3 style="margin:0 0 16px 0">⛽ Fuel Monitoring</h3>
          <div id="fuelGauge" style="
            width:100%;
            height:200px;
            background:linear-gradient(to bottom, #fef3c7, #fef08a);
            border-radius:8px;
            display:flex;
            align-items:center;
            justify-content:center;
            margin-bottom:12px;
            position:relative;
            overflow:hidden;
          ">
            <div style="text-align:center;z-index:1">
              <div id="fuelPercentage" style="font-size:2.4rem;font-weight:800;color:#b45309">--%</div>
              <div style="font-size:0.9rem;color:#92400e">Current Level</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.9rem">
            <div style="padding:8px;background:var(--surface-1);border-radius:6px">
              <div style="color:var(--text-muted)">Consumption</div>
              <div id="fuelConsumption" style="font-weight:600">-- L/100km</div>
            </div>
            <div style="padding:8px;background:var(--surface-1);border-radius:6px">
              <div style="color:var(--text-muted)">Distance</div>
              <div id="totalDistance" style="font-weight:600">-- km</div>
            </div>
          </div>
        </div>

        <!-- Tire Pressure Monitor -->
        <div style="background:var(--surface-2);padding:20px;border-radius:12px">
          <h3 style="margin:0 0 16px 0">🛞 Tire Pressure Monitor</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${['FL', 'FR', 'RL', 'RR'].map(tire => `
              <div style="
                background:var(--surface-1);
                padding:12px;
                border-radius:8px;
                text-align:center;
                border-left:4px solid #3b82f6;
              ">
                <div style="font-weight:600;margin-bottom:8px">${tire}</div>
                <div id="tire-${tire}-pressure" style="font-size:1.4rem;font-weight:bold;color:#3b82f6">-- PSI</div>
                <div id="tire-${tire}-temp" style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">-- °C</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Engine & RPM -->
        <div style="background:var(--surface-2);padding:20px;border-radius:12px">
          <h3 style="margin:0 0 16px 0">🔧 Engine Status</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:8px">
              <div style="color:var(--text-muted);margin-bottom:4px">Temperature</div>
              <div style="font-size:1.6rem;font-weight:bold">
                <span id="engineTemp">--</span>°C
              </div>
              <div style="margin-top:8px;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden">
                <div id="engineTempBar" style="height:100%;background:#f59e0b;width:50%;transition:width 0.2s"></div>
              </div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:8px">
              <div style="color:var(--text-muted);margin-bottom:4px">RPM</div>
              <div style="font-size:1.6rem;font-weight:bold">
                <span id="engineRPM">--</span>
              </div>
              <div style="margin-top:8px;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden">
                <div id="engineRPMBar" style="height:100%;background:#8b5cf6;width:50%;transition:width 0.2s"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Speed & Status -->
        <div style="background:var(--surface-2);padding:20px;border-radius:12px">
          <h3 style="margin:0 0 16px 0">📍 Status</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:8px">
              <div style="color:var(--text-muted);margin-bottom:4px">Speed</div>
              <div style="font-size:1.6rem;font-weight:bold;color:#10b981">
                <span id="currentSpeed">--</span> km/h
              </div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:8px">
              <div style="color:var(--text-muted);margin-bottom:4px">Status</div>
              <div style="font-size:1.6rem;font-weight:bold;color:#00d9ff">
                <span id="vehicleStatus">ACTIVE</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Alerts Section -->
      <div style="margin-top:20px;background:var(--surface-2);padding:16px;border-radius:12px;display:none" id="alertsSection">
        <h3 style="margin:0 0 12px 0">🚨 Active Alerts</h3>
        <div id="alertsList" style="max-height:200px;overflow-y:auto"></div>
      </div>

      <!-- Info -->
      <div style="margin-top:20px;padding:12px;background:#f0f9ff;border-left:4px solid #00d9ff;border-radius:6px;font-size:0.9rem;color:#0f1e33">
        <strong>🎮 Demo Mode:</strong> Real-time vehicle simulation with GPS tracking, fuel consumption, tire pressure, and engine diagnostics. Data updates every second. Select a vehicle to see live details.
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Attach event listeners
  const vehicleBtns = container.querySelectorAll('.vehicle-btn');
  vehicleBtns.forEach(btn => {
    btn.onclick = () => {
      vehicleBtns.forEach(b => b.style.borderColor = 'transparent');
      btn.style.borderColor = '#00d9ff';
      selectedVehicleId = parseInt(btn.dataset.id);
    };
    if (selectedVehicleId === null && btn.dataset.id === '1') {
      btn.click();
    }
  });

  // Update live data every second
  setInterval(() => {
    if (!selectedVehicleId || !window.VehicleSimulator) return;

    const data = window.VehicleSimulator.getVehicleData(selectedVehicleId);
    if (!data) return;

    // Update fuel gauge
    const fuelPct = container.querySelector('#fuelPercentage');
    if (fuelPct) fuelPct.textContent = `${data.fuel.toFixed(1)}%`;

    // Update fuel consumption & distance
    container.querySelector('#fuelConsumption').textContent = `${((data.speed / 80) * 8).toFixed(2)} L/100km`;
    container.querySelector('#totalDistance').textContent = `${data.distance.toFixed(1)} km`;

    // Update tire pressures
    ['FL', 'FR', 'RL', 'RR'].forEach(tire => {
      container.querySelector(`#tire-${tire}-pressure`).textContent = `${data.tires[tire].pressure.toFixed(1)} PSI`;
      container.querySelector(`#tire-${tire}-temp`).textContent = `${data.tires[tire].temp.toFixed(0)} °C`;
    });

    // Update engine
    container.querySelector('#engineTemp').textContent = data.engine_temp.toFixed(1);
    container.querySelector('#engineTempBar').style.width = `${(data.engine_temp / 120) * 100}%`;
    container.querySelector('#engineRPM').textContent = `${(data.rpm / 100).toFixed(0)}00`;
    container.querySelector('#engineRPMBar').style.width = `${(data.rpm / 5000) * 100}%`;

    // Update speed
    container.querySelector('#currentSpeed').textContent = data.speed.toFixed(0);

    // Update alerts
    const alertsSection = container.querySelector('#alertsSection');
    const alertsList = container.querySelector('#alertsList');
    if (data.alerts.length > 0) {
      alertsSection.style.display = 'block';
      alertsList.innerHTML = data.alerts.map(a => `
        <div style="padding:8px;margin-bottom:8px;background:var(--surface-1);border-radius:6px;border-left:3px solid ${
          a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : '#3b82f6'
        }">
          <strong>${a.message}</strong>
        </div>
      `).join('');
    } else {
      alertsSection.style.display = 'none';
    }

    // Update GPS locations
    const locationsDiv = container.querySelector('#vehicleLocations');
    if (locationsDiv && window.VehicleSimulator) {
      const allVehicles = window.VehicleSimulator.getAllVehicles();
      locationsDiv.innerHTML = allVehicles.map(v => `
        <div style="margin:4px 0">📍 ${v.vehicle.name}: ${v.position.lat.toFixed(4)}, ${v.position.lng.toFixed(4)}</div>
      `).join('');
    }
  }, 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initDemoDashboard, 200));
} else {
  setTimeout(initDemoDashboard, 200);
}
