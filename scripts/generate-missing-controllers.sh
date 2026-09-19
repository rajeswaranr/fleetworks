#!/bin/bash

# Generate all missing controllers for FleetWorks dashboard
# Usage: bash scripts/generate-missing-controllers.sh

echo "🚀 Generating missing controllers..."

CONTROLLER_DIR="js/modules/fleet-ops/controllers"

# 1. Drivers Controller
cat > "$CONTROLLER_DIR/drivers.controller.js" << 'EOF'
async function initDrivers() {
  if (!window.supabaseUser) return;
  const { data: drivers } = await window.supabase
    .from('drivers').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = (drivers || []).map(d => `
    <div style="padding:12px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px">
      <div style="font-weight:600">${d.name}</div>
      <div style="font-size:0.85rem;color:var(--text-muted)">${d.phone || 'N/A'}</div>
    </div>`).join('');
  document.querySelector('#tab-drivers').innerHTML = html || 'No drivers';
}
setTimeout(initDrivers, 100);
EOF

# 2. Insurance Dashboard Controller
cat > "$CONTROLLER_DIR/insurance-dashboard.controller.js" << 'EOF'
async function initInsuranceDash() {
  if (!window.supabaseUser) return;
  const { data: policies } = await window.supabase
    .from('insurance_policies').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = `<div class="stat-row">
    <div class="stat-card"><div class="stat-label">Active Policies</div><div class="stat-value">${(policies || []).length}</div></div>
  </div>`;
  document.getElementById('insuredash') && (document.getElementById('insuredash').innerHTML = html);
}
setTimeout(initInsuranceDash, 100);
EOF

# 3. Work Orders Controller
cat > "$CONTROLLER_DIR/work-orders.controller.js" << 'EOF'
async function initWorkOrders() {
  if (!window.supabaseUser) return;
  const { data: orders } = await window.supabase
    .from('work_orders').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = (orders || []).map(o => `<div style="padding:12px;border:1px solid var(--border);margin-bottom:8px">${o.title || 'Order'}</div>`).join('');
  document.querySelector('#tab-workorders').innerHTML = html || 'No work orders';
}
setTimeout(initWorkOrders, 100);
EOF

# 4. Spares Godown Controller
cat > "$CONTROLLER_DIR/spares-godown.controller.js" << 'EOF'
async function initSpares() {
  if (!window.supabaseUser) return;
  const { data: items } = await window.supabase
    .from('inventory_items').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = (items || []).map(i => `<div style="padding:8px;border-bottom:1px solid var(--border)">${i.name}: ${i.qty} units</div>`).join('');
  document.querySelector('#tab-parts').innerHTML = html || 'No items';
}
setTimeout(initSpares, 100);
EOF

# 5. Team Access Controller
cat > "$CONTROLLER_DIR/team-access.controller.js" << 'EOF'
async function initTeam() {
  if (!window.supabaseUser) return;
  const { data: members } = await window.supabase
    .from('team_members').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = (members || []).map(m => `<div style="padding:12px;border:1px solid var(--border);margin-bottom:8px"><strong>${m.name}</strong> (${m.role})</div>`).join('');
  document.querySelector('#tab-team').innerHTML = html || 'No team members';
}
setTimeout(initTeam, 100);
EOF

# 6-13. Create stub controllers for remaining features
for feature in inspections documents tyre-readings garage-directory service-requests whatsapp analytics reminders; do
  cat > "$CONTROLLER_DIR/$feature.controller.js" << EOF
async function init${feature^}() {
  const container = document.querySelector('#tab-$feature') || document.querySelector('[data-tab="$feature"]');
  if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Coming soon...</div>';
}
setTimeout(init${feature^}, 100);
EOF
done

echo "✅ All controller stubs generated!"
ls -la $CONTROLLER_DIR/*.controller.js | wc -l
echo "controllers created/updated"
