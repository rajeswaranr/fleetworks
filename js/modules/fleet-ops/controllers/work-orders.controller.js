async function initWorkOrders() {
  if (!window.supabaseUser) return;
  const { data: orders } = await window.supabase
    .from('work_orders').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = (orders || []).map(o => `<div style="padding:12px;border:1px solid var(--border);margin-bottom:8px">${o.title || 'Order'}</div>`).join('');
  document.querySelector('#tab-workorders').innerHTML = html || 'No work orders';
}
setTimeout(initWorkOrders, 100);
