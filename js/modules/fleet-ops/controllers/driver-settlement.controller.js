/**
 * Driver Settlement Module
 * Manages driver payments, EMI reconciliation, and settlement reports
 */

async function initDriverSettlement() {
  console.log('Initializing Driver Settlement...');
  try {
    if (!window.supabaseUser) return;

    // Load driver settlement data
    const { data: settlements } = await window.supabase
      .from('driver_settlements')
      .select('*, driver:driver_id(name, phone), trips:trip_id(*)')
      .eq('org_id', window.supabaseUser.org_id)
      .order('settlement_date', { ascending: false });

    // Load pending payments
    const { data: pending } = await window.supabase
      .from('driver_payments')
      .select('*, driver:driver_id(name)')
      .eq('org_id', window.supabaseUser.org_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    const container = document.querySelector('#tab-driver-settlement') || document.getElementById('driverSettlementContainer');
    if (!container) return;

    // Calculate stats
    const totalPending = (pending || []).reduce((sum, p) => sum + (p.amount || 0), 0);
    const thisMonthSettlements = (settlements || []).filter(s => {
      const date = new Date(s.settlement_date);
      const now = new Date();
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });

    let html = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">💳 Driver Settlement</h2>

        <!-- KPI Cards -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">This Month</div>
            <div style="font-size:2rem;font-weight:bold">₹${(thisMonthSettlements.reduce((sum, s) => sum + (s.amount_settled || 0), 0) / 100000).toFixed(1)}L</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">${thisMonthSettlements.length} settlements</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Pending Payment</div>
            <div style="font-size:2rem;font-weight:bold;color:#f59e0b">₹${(totalPending / 100000).toFixed(1)}L</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">${pending?.length || 0} drivers</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Avg Settlement</div>
            <div style="font-size:2rem;font-weight:bold">₹${settlements?.length > 0 ? (settlements.reduce((sum, s) => sum + (s.amount_settled || 0), 0) / settlements.length / 1000).toFixed(0) + 'K' : '0'}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Per driver</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Settled</div>
            <div style="font-size:2rem;font-weight:bold;color:#10b981">${(settlements || []).filter(s => s.status === 'settled').length}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">drivers paid</div>
          </div>
        </div>

        <!-- Settlement Components -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
          <!-- Trip-wise Breakdown -->
          <div style="padding:16px;background:var(--surface-2);border-radius:8px">
            <h3 style="margin:0 0 12px 0">📋 Settlement Formula</h3>
            <div style="font-size:0.9rem;line-height:1.6;color:var(--text-muted)">
              <div><strong>Base Pay</strong> = Fixed monthly rate</div>
              <div><strong>Distance Bonus</strong> = ₹1.5/km × total km</div>
              <div><strong>Dearness</strong> = ₹2/km (fuel allowance)</div>
              <div><strong>Halt Charges</strong> = ₹100/halt (>2hrs)</div>
              <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
                <strong style="color:#10b981">Total Payable</strong> = Base + Distance + Dearness + Halts - Deductions
              </div>
            </div>
          </div>

          <!-- Deductions -->
          <div style="padding:16px;background:var(--surface-2);border-radius:8px">
            <h3 style="margin:0 0 12px 0">💸 Deductions</h3>
            <div style="font-size:0.9rem;line-height:1.6;color:var(--text-muted)">
              <div><strong style="color:#ef4444">Speeding</strong> = ₹50/instance</div>
              <div><strong style="color:#ef4444">Harsh Events</strong> = ₹100/event</div>
              <div><strong style="color:#ef4444">Late Delivery</strong> = ₹200</div>
              <div><strong style="color:#ef4444">Fuel Variance</strong> = Pilferage value</div>
              <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
                <strong style="color:#ef4444">EMI/Advance</strong> = Monthly recovery
              </div>
            </div>
          </div>
        </div>

        <!-- Pending Payments -->
        ${pending && pending.length > 0 ? `
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
            <h3 style="margin:0 0 12px 0">⏳ Pending Payments</h3>
            ${pending.slice(0, 10).map(p => `
              <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-1);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:600">${p.driver?.name || 'Driver'}</div>
                  <div style="font-size:0.85rem;color:var(--text-muted)">Settlement Period: ${new Date(p.period_start).toLocaleDateString('en-IN')} - ${new Date(p.period_end).toLocaleDateString('en-IN')}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-size:1.2rem;font-weight:bold;color:#10b981">₹${(p.amount / 100000).toFixed(1)}L</div>
                  <button onclick="markPaymentPaid('${p.id}')" style="padding:6px 12px;background:#10b981;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.8rem;margin-top:4px">Mark Paid</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Settlement History -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px">
          <h3 style="margin:0 0 12px 0">📜 Settlement History</h3>
          ${settlements && settlements.length > 0 ? `
            <div style="max-height:400px;overflow-y:auto">
              ${settlements.slice(0, 20).map(s => `
                <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-1);margin-bottom:8px;display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:12px;align-items:center">
                  <div>
                    <div style="font-weight:600">${s.driver?.name || 'Driver'}</div>
                    <div style="font-size:0.8rem;color:var(--text-muted)">${new Date(s.settlement_date).toLocaleDateString('en-IN')}</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">Trips</div>
                    <div style="font-weight:600">${s.trips?.length || 0}</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">Amount</div>
                    <div style="font-weight:600">₹${(s.amount_settled / 1000).toFixed(0)}K</div>
                  </div>
                  <div style="text-align:right">
                    <span style="padding:4px 8px;background:${s.status === 'settled' ? '#10b98120;color:#10b981' : '#f59e0b20;color:#f59e0b'};border-radius:4px;font-size:0.8rem;font-weight:bold">${s.status?.toUpperCase()}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div style="text-align:center;padding:20px;color:var(--text-muted)">No settlement history</div>'}
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (error) {
    console.error('Driver settlement error:', error);
  }
}

async function markPaymentPaid(paymentId) {
  try {
    const { error } = await window.supabase
      .from('driver_payments')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', paymentId);

    if (!error) {
      alert('✓ Payment marked as paid');
      setTimeout(initDriverSettlement, 500);
    }
  } catch (error) {
    console.error('Error updating payment:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initDriverSettlement, 100));
} else {
  setTimeout(initDriverSettlement, 100);
}
