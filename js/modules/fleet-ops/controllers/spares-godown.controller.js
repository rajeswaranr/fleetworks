/**
 * Spares Godown Controller with FleetAI Anomaly Detection
 * Detects price anomalies and stock level alerts
 */

let sparesData = {
  items: [],
  anomalies: [],
  priceHistory: {}
};

async function initSpares() {
  console.log('Initializing Spares Godown with AI Anomaly Detection...');
  try {
    if (!window.supabaseUser) return;

    // Load inventory items
    const { data: items } = await window.supabase
      .from('inventory_items')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .order('updated_at', { ascending: false });

    // Load price history for anomaly detection
    const { data: priceHistory } = await window.supabase
      .from('spare_parts_prices')
      .select('part_id, part_number, avg_price, last_price, price_std, updated_at')
      .eq('org_id', window.supabaseUser.org_id);

    sparesData.items = items || [];
    sparesData.priceHistory = (priceHistory || []).reduce((acc, p) => {
      acc[p.part_id] = p;
      return acc;
    }, {});

    // Detect anomalies
    detectPriceAnomalies();
    renderSparesGodown();
  } catch (error) {
    console.error('Spares controller error:', error);
  }
}

function detectPriceAnomalies() {
  sparesData.anomalies = [];

  sparesData.items.forEach(item => {
    const history = sparesData.priceHistory[item.id];
    if (!history) return;

    const deviation = Math.abs(item.current_price - history.avg_price) / history.avg_price;
    const isAnomalous = deviation > 0.25; // 25% threshold
    const isLowStock = item.qty <= item.min_stock_level;

    if (isAnomalous || isLowStock) {
      sparesData.anomalies.push({
        partId: item.id,
        partNumber: item.part_number,
        name: item.name,
        type: isAnomalous ? 'price_anomaly' : 'low_stock',
        severity: isAnomalous && deviation > 0.5 ? 'critical' : 'warning',
        currentPrice: item.current_price,
        avgPrice: history.avg_price,
        deviation: (deviation * 100).toFixed(1),
        quantity: item.qty,
        minLevel: item.min_stock_level
      });
    }
  });

  sparesData.anomalies.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

function renderSparesGodown() {
  const container = document.querySelector('#tab-parts') || document.getElementById('sparesContainer');
  if (!container) return;

  let html = '';

  // Anomaly alerts section
  if (sparesData.anomalies.length > 0) {
    html += `<div style="margin-bottom:20px;padding:12px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px">
      <div style="font-weight:600;color:#78350f;margin-bottom:8px">🚨 ${sparesData.anomalies.length} Anomalies Detected</div>
      ${sparesData.anomalies.slice(0, 5).map(a => `
        <div style="padding:8px;background:white;border-radius:4px;margin-bottom:6px;font-size:0.85rem">
          <div style="font-weight:600">${a.name} (${a.partNumber})</div>
          ${a.type === 'price_anomaly'
            ? `<div style="color:#ef4444">Price ${a.deviation}% above average: ₹${a.currentPrice.toFixed(2)} vs ₹${a.avgPrice.toFixed(2)}</div>`
            : `<div style="color:#f59e0b">Low stock: ${a.quantity}/${a.minLevel} units</div>`
          }
        </div>
      `).join('')}
    </div>`;
  }

  // Inventory items grid
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">`;
  sparesData.items.forEach(item => {
    const history = sparesData.priceHistory[item.id];
    const anomaly = sparesData.anomalies.find(a => a.partId === item.id);
    const borderColor = anomaly?.severity === 'critical' ? '#ef4444' : anomaly?.severity === 'warning' ? '#f59e0b' : '#ddd';

    html += `
      <div style="padding:12px;border:2px solid ${borderColor};border-radius:8px;background:var(--surface-2)">
        <div style="font-weight:600;margin-bottom:4px">${item.name}</div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:8px">${item.part_number}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem">
          <div>
            <span style="color:var(--text-muted)">Stock</span><br/>
            <span style="font-weight:600;color:${item.qty <= item.min_stock_level ? '#ef4444' : '#10b981'}">${item.qty}/${item.min_stock_level}</span>
          </div>
          <div>
            <span style="color:var(--text-muted)">Price</span><br/>
            <span style="font-weight:600">₹${item.current_price?.toFixed(2) || '0'}</span>
          </div>
        </div>
        ${history ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:0.8rem;color:var(--text-muted)">
          Avg: ₹${history.avg_price.toFixed(2)}
        </div>` : ''}
      </div>
    `;
  });
  html += '</div>';

  container.innerHTML = html;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initSpares, 100));
} else {
  setTimeout(initSpares, 100);
}
