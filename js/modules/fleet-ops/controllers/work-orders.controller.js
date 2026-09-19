/**
 * Work Orders Controller
 * Manages maintenance scheduling, assignment, and tracking
 */

let workOrderData = {
  orders: [],
  stats: { pending: 0, assigned: 0, completed: 0, overdue: 0 }
};

async function initWorkOrders() {
  console.log('Initializing Work Orders...');
  try {
    if (!window.supabaseUser) return;

    const { data: orders } = await window.supabase
      .from('work_orders')
      .select('*, vehicle:vehicle_id(registration), mechanic:assigned_to(name)')
      .eq('org_id', window.supabaseUser.org_id)
      .order('created_at', { ascending: false });

    workOrderData.orders = orders || [];
    calculateWorkOrderStats();
    renderWorkOrders();
  } catch (error) {
    console.error('Work orders error:', error);
  }
}

function calculateWorkOrderStats() {
  const now = new Date();
  workOrderData.stats = {
    pending: workOrderData.orders.filter(o => o.status === 'pending').length,
    assigned: workOrderData.orders.filter(o => o.status === 'assigned').length,
    completed: workOrderData.orders.filter(o => o.status === 'completed').length,
    overdue: workOrderData.orders.filter(o => o.status !== 'completed' && new Date(o.due_date) < now).length
  };
}

function renderWorkOrders() {
  const container = document.querySelector('#tab-workorders') || document.getElementById('workOrdersContainer');
  if (!container) return;

  const stats = workOrderData.stats;
  let html = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold">${stats.pending}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Pending</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#3b82f6">${stats.assigned}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Assigned</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#10b981">${stats.completed}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Completed</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#ef4444">${stats.overdue}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Overdue</div>
      </div>
    </div>
  `;

  // Work orders list
  html += workOrderData.orders.slice(0, 20).map(o => {
    const statusColors = { pending: '#999', assigned: '#3b82f6', in_progress: '#f59e0b', completed: '#10b981', cancelled: '#ef4444' };
    const isOverdue = new Date(o.due_date) < new Date() && o.status !== 'completed';

    return `
      <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <div style="font-weight:600">${o.title}</div>
            <div style="font-size:0.85rem;color:var(--text-muted)">${o.vehicle?.registration || 'Unknown'} • ${o.category || 'Maintenance'}</div>
          </div>
          <div style="padding:4px 8px;background:${statusColors[o.status]}20;color:${statusColors[o.status]};border-radius:4px;font-size:0.8rem;font-weight:bold">${o.status?.toUpperCase()}</div>
        </div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:8px">${o.description || ''}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.85rem">
          <div>
            <span style="color:var(--text-muted)">Assigned to: </span>
            <span>${o.mechanic?.name || 'Unassigned'}</span>
          </div>
          <div style="color:${isOverdue ? '#ef4444' : 'var(--text-muted)'};font-weight:${isOverdue ? '600' : 'normal'}">
            Due: ${new Date(o.due_date).toLocaleDateString('en-IN')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html || '<div style="text-align:center;padding:20px;color:var(--text-muted)">No work orders</div>';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initWorkOrders, 100));
} else {
  setTimeout(initWorkOrders, 100);
}
