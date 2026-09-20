/**
 * GST Compliance Controller
 * Generates invoices, e-way bills, and manages tax settlement
 */

async function initGSTCompliance() {
  console.log('Initializing GST Compliance Module...');
  try {
    if (!window.supabaseUser) return;

    // Load GST config
    const { data: gstConfig } = await window.supabase
      .from('gst_configuration')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .single();

    // Load invoices
    const { data: invoices } = await window.supabase
      .from('gst_invoices')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .gte('invoice_date', new Date(Date.now() - 90*24*60*60*1000).toISOString().split('T')[0])
      .order('invoice_date', { ascending: false });

    // Load settlement summary
    const { data: settlement } = await window.supabase
      .from('gst_settlement_summary')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .order('settlement_month', { ascending: false })
      .limit(1)
      .single();

    const container = document.querySelector('#tab-gst-compliance') || document.getElementById('gstComplianceContainer');
    if (!container) return;

    // Calculate stats
    const unpaidInvoices = (invoices || []).filter(inv => inv.payment_status === 'unpaid');
    const totalTaxableAmount = (invoices || []).reduce((sum, inv) => sum + (inv.taxable_amount || 0), 0);
    const totalGSTCollected = (invoices || []).reduce((sum, inv) => sum + (inv.total_gst_amount || 0), 0);

    let html = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">💰 GST Compliance</h2>

        <!-- Configuration Status -->
        ${!gstConfig ? `
          <div style="padding:16px;background:#fef3c720;border-left:4px solid #f59e0b;border-radius:8px;margin-bottom:20px">
            <strong style="color:#78350f">⚠️ Setup Required</strong><br/>
            <div style="font-size:0.85rem;color:#78350f;margin-top:8px">
              Configure your GSTIN and SBIN credentials to enable e-way bill generation.<br/>
              <button onclick="showGSTSetup()" style="padding:6px 12px;background:#f59e0b;color:white;border:none;border-radius:4px;margin-top:8px;cursor:pointer;font-weight:600">Setup Now</button>
            </div>
          </div>
        ` : `
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:0.9rem">
              <div>
                <span style="color:var(--text-muted)">GSTIN:</span> <strong style="font-family:monospace">${gstConfig.gstin}</strong>
              </div>
              <div>
                <span style="color:var(--text-muted)">Tax Slab:</span> <strong>${gstConfig.tax_slab_pct}%</strong>
              </div>
              <div>
                <span style="color:var(--text-muted)">SBIN Status:</span> <strong style="color:#10b981">✓ Connected</strong>
              </div>
              <div>
                <span style="color:var(--text-muted)">Auto-Invoice:</span> <strong>${gstConfig.auto_generate_invoices ? '✓ Enabled' : '✗ Disabled'}</strong>
              </div>
            </div>
          </div>
        `}

        <!-- KPI Cards -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #3b82f6">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Invoices (90 days)</div>
            <div style="font-size:2rem;font-weight:bold">${invoices?.length || 0}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Generated</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #ef4444">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Unpaid Invoices</div>
            <div style="font-size:2rem;font-weight:bold;color:#ef4444">${unpaidInvoices.length}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Action Required</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #10b981">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">Taxable Amount</div>
            <div style="font-size:2rem;font-weight:bold">₹${(totalTaxableAmount / 100000).toFixed(1)}L</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">90-day total</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;border-left:4px solid #f59e0b">
            <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:4px">GST Collected</div>
            <div style="font-size:2rem;font-weight:bold">₹${(totalGSTCollected / 100000).toFixed(2)}L</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Total tax</div>
          </div>
        </div>

        <!-- Quick Actions -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">⚡ Quick Actions</h3>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
            <button onclick="generateInvoiceForTrip()" style="padding:12px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600">
              📄 Generate Invoice
            </button>
            <button onclick="generateEwayBill()" style="padding:12px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600">
              🛣️ Generate E-way Bill
            </button>
            <button onclick="fileGSTR()" style="padding:12px;background:#f59e0b;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600">
              📊 File GSTR-1
            </button>
            <button onclick="showGSTSetup()" style="padding:12px;background:#8b5cf6;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600">
              ⚙️ Settings
            </button>
          </div>
        </div>

        <!-- Invoices List -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">📋 Recent Invoices</h3>
          ${invoices && invoices.length > 0 ? `
            <div style="max-height:500px;overflow-y:auto">
              ${invoices.slice(0, 20).map(inv => `
                <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-1);margin-bottom:8px;display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr 1fr;gap:12px;align-items:center">
                  <div>
                    <div style="font-weight:600">${inv.invoice_number}</div>
                    <div style="font-size:0.8rem;color:var(--text-muted)">${new Date(inv.invoice_date).toLocaleDateString('en-IN')}</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">Consignee</div>
                    <div style="font-weight:600;font-size:0.9rem">${inv.consignee_name?.substring(0, 15)}</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">Taxable</div>
                    <div style="font-weight:600">₹${(inv.taxable_amount / 1000).toFixed(0)}K</div>
                  </div>
                  <div>
                    <div style="font-size:0.85rem;color:var(--text-muted)">GST</div>
                    <div style="font-weight:600">₹${(inv.total_gst_amount / 1000).toFixed(0)}K</div>
                  </div>
                  <div style="text-align:right">
                    <div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:4px">
                      <span style="padding:2px 6px;background:${inv.payment_status === 'paid' ? '#10b98120;color:#10b981' : '#ef444420;color:#ef4444'};border-radius:3px;font-size:0.75rem;font-weight:bold">
                        ${inv.payment_status?.toUpperCase()}
                      </span>
                      ${inv.eway_bill_number ? `<span style="padding:2px 6px;background:#3b82f620;color:#3b82f6;border-radius:3px;font-size:0.75rem;font-weight:bold">E-Bill ✓</span>` : ''}
                    </div>
                    <button onclick="viewInvoice('${inv.id}')" style="padding:4px 8px;background:#3b82f6;color:white;border:none;border-radius:3px;cursor:pointer;font-size:0.75rem">View</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div style="text-align:center;padding:20px;color:var(--text-muted)">No invoices</div>'}
        </div>

        <!-- GST Settlement Summary -->
        ${settlement ? `
          <div style="padding:16px;background:var(--surface-2);border-radius:8px">
            <h3 style="margin:0 0 12px 0">📊 Current Settlement (${settlement.settlement_month})</h3>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:0.9rem">
              <div style="padding:12px;background:var(--surface-1);border-radius:6px">
                <div style="color:var(--text-muted);margin-bottom:4px">Total Invoices</div>
                <div style="font-weight:600">${settlement.total_invoices}</div>
              </div>
              <div style="padding:12px;background:var(--surface-1);border-radius:6px">
                <div style="color:var(--text-muted);margin-bottom:4px">GST Collected</div>
                <div style="font-weight:600">₹${(settlement.total_gst_collected / 100000).toFixed(2)}L</div>
              </div>
              <div style="padding:12px;background:var(--surface-1);border-radius:6px">
                <div style="color:var(--text-muted);margin-bottom:4px">GST Payable</div>
                <div style="font-weight:600;color:${settlement.gst_payable > 0 ? '#ef4444' : '#10b981'}">₹${(settlement.gst_payable / 100000).toFixed(2)}L</div>
              </div>
            </div>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-size:0.85rem;color:var(--text-muted)">GSTR-1 Filing</div>
                  <div style="font-weight:600">${settlement.gstr_1_filed ? '✓ Filed on ' + new Date(settlement.gstr_1_filed_date).toLocaleDateString('en-IN') : '⏳ Pending'}</div>
                </div>
                ${!settlement.gstr_1_filed ? `
                  <button onclick="fileGSTR()" style="padding:6px 12px;background:#f59e0b;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600">File Now</button>
                ` : ''}
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    container.innerHTML = html;
  } catch (error) {
    console.error('GST compliance error:', error);
  }
}

async function generateInvoiceForTrip() {
  const tripId = prompt('Enter Trip ID:');
  if (!tripId) return;

  try {
    // Call Edge Function to generate invoice
    const response = await fetch(
      `${window.SUPABASE_URL}/functions/v1/generate-gst-invoice`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          org_id: window.supabaseUser.org_id,
          trip_id: tripId
        })
      }
    );

    const data = await response.json();
    if (data.success) {
      alert(`✓ Invoice ${data.invoice_number} generated successfully`);
      setTimeout(initGSTCompliance, 500);
    } else {
      alert('Error: ' + data.error);
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

async function generateEwayBill() {
  const invoiceId = prompt('Enter Invoice Number/ID:');
  if (!invoiceId) return;

  try {
    const response = await fetch(
      `${window.SUPABASE_URL}/functions/v1/generate-eway-bill`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          org_id: window.supabaseUser.org_id,
          invoice_id: invoiceId
        })
      }
    );

    const data = await response.json();
    if (data.success) {
      alert(`✓ E-way Bill ${data.eway_bill_number} generated\nValid Till: ${new Date(data.valid_till).toLocaleDateString('en-IN')}`);
      setTimeout(initGSTCompliance, 500);
    } else {
      alert('Error: ' + data.error);
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

async function fileGSTR() {
  if (!(await FWDialog.confirm('File GSTR-1 for current month? This action cannot be undone.'))) return;

  try {
    const response = await fetch(
      `${window.SUPABASE_URL}/functions/v1/file-gstr`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          org_id: window.supabaseUser.org_id
        })
      }
    );

    const data = await response.json();
    if (data.success) {
      alert('✓ GSTR-1 filed successfully\nACK: ' + data.ack_number);
      setTimeout(initGSTCompliance, 500);
    } else {
      alert('Error: ' + data.error);
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

function showGSTSetup() {
  alert('GST Setup:\n\n1. Go to SBIN e-way bill portal\n2. Generate API credentials\n3. Enter GSTIN and credentials here\n4. Enable auto-invoice generation');
  // Open settings modal (to be implemented)
}

function viewInvoice(invoiceId) {
  alert('Invoice details: ' + invoiceId);
  // Open invoice detail view
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initGSTCompliance, 100));
} else {
  setTimeout(initGSTCompliance, 100);
}
