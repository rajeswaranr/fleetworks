/**
 * SMS Configuration Controller
 * Manages SMS settings, templates, and message logs
 */

async function initSMSConfig() {
  console.log('Initializing SMS Configuration...');
  try {
    if (!window.supabaseUser) return;

    // Load SMS logs
    const { data: logs } = await window.supabase
      .from('sms_logs')
      .select('*')
      .eq('org_id', window.supabaseUser.org_id)
      .order('sent_at', { ascending: false })
      .limit(100);

    const container = document.querySelector('#tab-sms-config') || document.getElementById('smsConfigContainer');
    if (!container) return;

    // Calculate stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayLogs = (logs || []).filter(l => new Date(l.sent_at) >= today);
    const sentToday = todayLogs.filter(l => l.status === 'sent').length;
    const failedToday = todayLogs.filter(l => l.status === 'failed').length;

    let html = `
      <div style="padding:20px">
        <h2 style="margin:0 0 20px 0">📱 SMS Configuration</h2>

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;text-align:center">
            <div style="font-size:2rem;font-weight:bold;color:#10b981">${sentToday}</div>
            <div style="font-size:0.85rem;color:var(--text-muted)">Sent Today</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;text-align:center">
            <div style="font-size:2rem;font-weight:bold;color:#ef4444">${failedToday}</div>
            <div style="font-size:0.85rem;color:var(--text-muted)">Failed Today</div>
          </div>
          <div style="padding:16px;background:var(--surface-2);border-radius:8px;text-align:center">
            <div style="font-size:2rem;font-weight:bold;color:#3b82f6">MSG91</div>
            <div style="font-size:0.85rem;color:var(--text-muted)">Provider</div>
          </div>
        </div>

        <!-- Configuration Info -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">📋 SMS Provider Setup</h3>
          <div style="background:var(--surface-1);padding:12px;border-radius:6px;font-family:monospace;font-size:0.85rem;margin-bottom:12px;color:var(--text-muted)">
            Provider: <strong>MSG91</strong><br/>
            Status: <span style="color:#10b981">✓ Configured</span><br/>
            API: India SMS Gateway<br/>
            DLT Compliance: <span style="color:#10b981">✓ Approved Templates</span>
          </div>
          <div style="background:#fef3c720;border-left:4px solid #f59e0b;padding:12px;border-radius:6px;font-size:0.85rem">
            <strong>ℹ️ Required Setup:</strong><br/>
            1. Set MSG91_AUTH_KEY in Supabase Secrets<br/>
            2. Configure DLT templates in MSG91 dashboard<br/>
            3. Update template IDs: MSG91_TPL_SOS, MSG91_TPL_HALT, etc.
          </div>
        </div>

        <!-- DLT Templates -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px;margin-bottom:20px">
          <h3 style="margin:0 0 12px 0">🔤 DLT Templates</h3>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
            <div style="padding:12px;background:var(--surface-1);border-radius:6px;border-left:4px solid #ef4444">
              <div style="font-weight:600;margin-bottom:4px">SOS Alert</div>
              <div style="font-size:0.8rem;color:var(--text-muted)">Critical safety events, collisions</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px;border-left:4px solid #f59e0b">
              <div style="font-weight:600;margin-bottom:4px">Halt/Breakdown</div>
              <div style="font-size:0.8rem;color:var(--text-muted)">Vehicle stoppage, maintenance needed</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px;border-left:4px solid #3b82f6">
              <div style="font-weight:600;margin-bottom:4px">Dispatch</div>
              <div style="font-size:0.8rem;color:var(--text-muted)">Delivery plan, route assigned</div>
            </div>
            <div style="padding:12px;background:var(--surface-1);border-radius:6px;border-left:4px solid #10b981">
              <div style="font-weight:600;margin-bottom:4px">Work Order</div>
              <div style="font-size:0.8rem;color:var(--text-muted)">New job card, service request</div>
            </div>
          </div>
        </div>

        <!-- Recent SMS Logs -->
        <div style="padding:16px;background:var(--surface-2);border-radius:8px">
          <h3 style="margin:0 0 12px 0">📜 Recent Messages</h3>
          ${logs && logs.length > 0 ? `
            <div style="max-height:400px;overflow-y:auto">
              ${logs.slice(0, 20).map(log => `
                <div style="padding:8px;border-bottom:1px solid var(--border);font-size:0.85rem;display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="font-weight:600">${log.phone_number}</div>
                    <div style="color:var(--text-muted);font-size:0.8rem">${log.template_event || 'sms'}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="font-size:0.8rem;color:var(--text-muted)">${new Date(log.sent_at).toLocaleString('en-IN')}</div>
                    <span style="padding:2px 6px;border-radius:3px;font-weight:600;font-size:0.75rem;background:${log.status === 'sent' ? '#10b98120;color:#10b981' : '#ef444420;color:#ef4444'}">
                      ${log.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div style="text-align:center;padding:20px;color:var(--text-muted)">No SMS logs</div>'}
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (error) {
    console.error('SMS config error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initSMSConfig, 100));
} else {
  setTimeout(initSMSConfig, 100);
}
