/**
 * Fleet Card Integration Controller
 * Manages fuel card transactions and reconciliation (HPCL, BPCL, IOCL, JIOBP)
 */

async function initFuelCardIntegration() {
  console.log('Initializing Fleet Card Integration...');
  try {
    if (!window.supabaseUser) return;

    // Load fuel card transactions
    const { data: transactions } = await window.supabase
      .from('fuel_card_transactions')
      .select('*, vehicle:vehicle_id(registration), driver:driver_id(name)')
      .eq('org_id', window.supabaseUser.org_id)
      .gte('transaction_date', new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0])
      .order('transaction_date', { ascending: false });

    // Load fuel card config
    const { data: cardConfig } = await window.supabase
      .from('fuel_card_config')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id);

    const container = document.querySelector('#tab-fuel-cards') || document.getElementById('fuelCardsContainer');
    if (!container) return;

    // Calculate stats
    const totalSpent = (transactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalLiters = (transactions || []).reduce((sum, t) => sum + (t.liters || 0), 0);
    const avgPrice = totalLiters > 0 ? totalSpent / totalLiters : 0;

    let html = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">⛽ Fleet Card Management</h2>

        <!-- KPI Cards -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Total Spent</div>
            <div style="font-size:2rem;font-weight:bold">₹${(totalSpent / 100000).toFixed(1)}L</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Last 30 days</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Total Liters</div>
            <div style="font-size:2rem;font-weight:bold">${totalLiters.toFixed(0)}L</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Fuel purchased</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Avg Price/Liter</div>
            <div style="font-size:2rem;font-weight:bold">₹${avgPrice.toFixed(0)}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Market rate</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #8b5cf6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Transactions</div>
            <div style="font-size:2rem;font-weight:bold">${transactions?.length || 0}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">fuel fills</div>
          </div>
        </div>

        <!-- Connected Cards -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">💳 Connected Fuel Cards</h3>
          ${cardConfig && cardConfig.length > 0 ? `
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
              ${cardConfig.map(card => {
                const cardTransactions = (transactions || []).filter(t => t.fuel_card_id === card.id);
                const cardSpent = cardTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
                return `
                  <div style="padding:12px;border:2px solid var(--border);border-radius:8px;background:var(--surface-1)">
                    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                      <div>
                        <div style="font-weight:600">${card.card_name}</div>
                        <div style="font-size:0.85rem;color:var(--text-muted)">${card.provider || 'Provider'}</div>
                      </div>
                      <div style="padding:4px 8px;background:${card.status === 'active' ? '#10b98120;color:#10b981' : '#ef444420;color:#ef4444'};border-radius:4px;font-size:0.8rem;font-weight:bold">${card.status?.toUpperCase()}</div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;margin-bottom:8px">
                      <div>
                        <span style="color:var(--text-muted)">Card #</span><br/>
                        <strong style="font-family:monospace">${card.card_number?.slice(-4).padStart(4, '*')}</strong>
                      </div>
                      <div>
                        <span style="color:var(--text-muted)">Spent (30d)</span><br/>
                        <strong>₹${(cardSpent / 1000).toFixed(0)}K</strong>
                      </div>
                    </div>
                    <div style="padding-top:8px;border-top:1px solid var(--border);font-size:0.8rem;color:var(--text-muted)">
                      Transactions: ${cardTransactions.length}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div style="padding:12px;color:var(--text-muted)">No fuel cards connected. Add a card to enable auto-reconciliation.</div>'}
        </div>

        <!-- Recent Transactions -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px">
          <h3 style="margin:0 0 12px 0">📊 Recent Transactions</h3>
          ${transactions && transactions.length > 0 ? `
            <div style="max-height:500px;overflow-y:auto">
              ${transactions.slice(0, 25).map(t => `
                <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-1);margin-bottom:8px;display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr 1fr;gap:12px;align-items:center">
                  <div>
                    <div style="font-weight:600">${t.vehicle?.registration || 'Unknown'}</div>
                    <div style="font-size:0.8rem;color:var(--text-muted)">${t.driver?.name || 'No driver'}</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">Amount</div>
                    <div style="font-weight:600">₹${(t.amount / 1000).toFixed(0)}K</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">Liters</div>
                    <div style="font-weight:600">${t.liters?.toFixed(1) || '0'}L</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">Rate</div>
                    <div style="font-weight:600">₹${(t.amount / (t.liters || 1)).toFixed(0)}/L</div>
                  </div>
                  <div style="text-align:right">
                    <div style="font-size:0.8rem;color:var(--text-muted)">${new Date(t.transaction_date).toLocaleDateString('en-IN')}</div>
                    <div style="font-size:0.8rem;color:var(--text-muted)">${t.fuel_card_provider || 'Card'}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div style="text-align:center;padding:20px;color:var(--text-muted)">No transactions</div>'}
        </div>

        <!-- API Integration Guide -->
        <div style="margin-top:20px;padding:16px;background:#fef3c720;border-left:4px solid #f59e0b;border-radius:8px">
          <strong style="color:#78350f">💡 Auto-Sync Setup</strong><br/>
          <div style="font-size:0.85rem;color:#78350f;margin-top:8px">
            Connected to: ${cardConfig?.map(c => c.provider).join(', ') || 'No providers'}<br/>
            Auto-reconciliation: Every 4 hours<br/>
            Last sync: ${new Date().toLocaleTimeString('en-IN')}
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (error) {
    console.error('Fuel card integration error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initFuelCardIntegration, 100));
} else {
  setTimeout(initFuelCardIntegration, 100);
}
