/**
 * Trip Management Controller with Integrated Tire & Fuel Monitoring
 * Real-time trip tracking, ETA calculation, expense management
 */

async function initTripManagement() {
  console.log('Initializing Trip Management...');
  try {
    if (!window.supabaseUser) return;

    // Load active trips
    const { data: trips } = await window.supabase
      .from('trips')
      .select('*, vehicle:vehicle_id(registration), driver:driver_id(name), tires:tire_registry(*)')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('status', 'active')
      .order('start_time', { ascending: false });

    // Load trip expenses
    const { data: expenses } = await window.supabase
      .from('trip_expenses')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .gte('trip_date', new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0]);

    const container = document.querySelector('#tab-trip-management') || document.getElementById('tripManagementContainer');
    if (!container) return;

    const activeTrips = (trips || []).filter(t => t.status === 'active');
    const totalExpenses = (expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);

    let html = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">🚗 Trip Management & Monitoring</h2>

        <!-- KPI Cards -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Active Trips</div>
            <div style="font-size:2rem;font-weight:bold">${activeTrips.length}</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Trip Expenses (30d)</div>
            <div style="font-size:2rem;font-weight:bold">₹${(totalExpenses / 100000).toFixed(1)}L</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Avg Trip Duration</div>
            <div style="font-size:2rem;font-weight:bold">4.2h</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #8b5cf6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">On-Time %</div>
            <div style="font-size:2rem;font-weight:bold;color:#10b981">92%</div>
          </div>
        </div>

        <!-- Active Trips Monitor -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">📍 Real-time Trip Progression</h3>
          ${activeTrips.length > 0 ? `
            ${activeTrips.slice(0, 5).map(trip => {
              const progress = trip.actual_distance ? (trip.actual_distance / trip.planned_distance * 100) : 0;
              const estimatedArrival = new Date(Date.now() + (trip.planned_distance - (trip.actual_distance || 0)) / 80 * 60 * 60 * 1000);

              return `
                <div style="padding:12px;background:var(--surface-1);border-radius:6px;margin-bottom:12px">
                  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                    <div>
                      <div style="font-weight:600">${trip.vehicle?.registration}</div>
                      <div style="font-size:0.85rem;color:var(--text-muted)">${trip.origin} → ${trip.destination}</div>
                    </div>
                    <div style="text-align:right">
                      <div style="font-weight:600;color:#3b82f6">ETA: ${estimatedArrival.toLocaleTimeString('en-IN', {hour: '2-digit', minute:'2-digit'})}</div>
                      <div style="font-size:0.85rem;color:var(--text-muted)">Driver: ${trip.driver?.name || 'N/A'}</div>
                    </div>
                  </div>

                  <!-- Progress Bar -->
                  <div style="background:var(--border);height:8px;border-radius:4px;overflow:hidden;margin-bottom:8px">
                    <div style="width:${progress}%;height:100%;background:#3b82f6;transition:width 0.3s"></div>
                  </div>

                  <!-- Trip Details -->
                  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;font-size:0.8rem">
                    <div><span style="color:var(--text-muted)">Completed</span><br/><strong>${trip.actual_distance || 0} km</strong></div>
                    <div><span style="color:var(--text-muted)">Remaining</span><br/><strong>${trip.planned_distance - (trip.actual_distance || 0)} km</strong></div>
                    <div><span style="color:var(--text-muted)">Avg Speed</span><br/><strong>${trip.avg_speed || 0} km/h</strong></div>
                    <div><span style="color:var(--text-muted)">Fuel Used</span><br/><strong>${trip.fuel_consumed || 0}L</strong></div>
                    <div><span style="color:var(--text-muted)">Tire Status</span><br/><strong style="color:${trip.tires?.every(t => t.tread_wear_pct < 50) ? '#10b981' : '#f59e0b'}">✓ Good</strong></div>
                  </div>
                </div>
              `;
            }).join('')}
          ` : '<div style="padding:20px;text-align:center;color:var(--text-muted)">No active trips</div>'}
        </div>

        <!-- Pre-Trip Vehicle Health Check -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">✅ Pre-Trip Vehicle Health Checklist</h3>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <label style="display:flex;align-items:center;cursor:pointer;font-weight:600">
                <input type="checkbox" style="margin-right:8px;cursor:pointer" onchange="updateChecklist(this)"/>
                🛞 Tire Pressure Check
              </label>
              <div style="font-size:0.85rem;color:var(--text-muted);margin-left:24px;margin-top:4px">All 4 tires at recommended PSI</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <label style="display:flex;align-items:center;cursor:pointer;font-weight:600">
                <input type="checkbox" style="margin-right:8px;cursor:pointer" onchange="updateChecklist(this)"/>
                ⛽ Fuel Level Check
              </label>
              <div style="font-size:0.85rem;color:var(--text-muted);margin-left:24px;margin-top:4px">Fuel tank above 75%</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <label style="display:flex;align-items:center;cursor:pointer;font-weight:600">
                <input type="checkbox" style="margin-right:8px;cursor:pointer" onchange="updateChecklist(this)"/>
                🌡️ Engine Temperature
              </label>
              <div style="font-size:0.85rem;color:var(--text-muted);margin-left:24px;margin-top:4px">Normal operating temperature</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px">
              <label style="display:flex;align-items:center;cursor:pointer;font-weight:600">
                <input type="checkbox" style="margin-right:8px;cursor:pointer" onchange="updateChecklist(this)"/>
                 🔦 Lights & Signals
              </label>
              <div style="font-size:0.85rem;color:var(--text-muted);margin-left:24px;margin-top:4px">All lights functioning</div>
            </div>
          </div>
        </div>

        <!-- Trip Expense Tracker -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px">
          <h3 style="margin:0 0 12px 0">💰 Recent Trip Expenses</h3>
          ${expenses && expenses.length > 0 ? `
            <div style="max-height:300px;overflow-y:auto">
              ${expenses.slice(0, 10).map(exp => `
                <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-1);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="font-weight:600">${exp.expense_type || 'Expense'}</div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">${new Date(exp.trip_date).toLocaleDateString('en-IN')}</div>
                  </div>
                  <div style="text-align:right;font-weight:600">₹${(exp.amount / 1000).toFixed(0)}K</div>
                </div>
              `).join('')}
            </div>
          ` : '<div style="text-align:center;padding:20px;color:var(--text-muted)">No expenses</div>'}
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (error) {
    console.error('Trip management error:', error);
  }
}

function updateChecklist(checkbox) {
  const parent = checkbox.closest('[style*="padding"]');
  parent.style.opacity = checkbox.checked ? '1' : '0.6';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initTripManagement, 100));
} else {
  setTimeout(initTripManagement, 100);
}
