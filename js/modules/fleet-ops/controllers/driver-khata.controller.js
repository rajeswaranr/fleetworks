/**
 * Driver Khata Controller
 * Manages driver expense ledger, settlements, and downloads
 */

const DriverKhataController = {
  currentFilter: {
    driverId: null,
    startDate: null,
    endDate: null
  },

  init() {
    const container = document.getElementById('khataContainer');
    if (!container) return;

    // Build UI
    this.renderFilters(container);
    this.renderTable(container);
    this.attachEventListeners(container);

    console.log('✅ Driver Khata initialized');
  },

  renderFilters(container) {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    container.innerHTML = `
      <div class="khata-header">
        <h2>Driver Khata (Ledger)</h2>
        <div class="khata-controls">
          <div class="control-group">
            <label>Driver</label>
            <select id="khataDriverFilter">
              <option value="">All Drivers</option>
            </select>
          </div>
          <div class="control-group">
            <label>From</label>
            <input type="date" id="khataStartDate" value="${thirtyDaysAgo}" />
          </div>
          <div class="control-group">
            <label>To</label>
            <input type="date" id="khataEndDate" value="${today}" />
          </div>
          <button class="btn btn-primary" id="khataFilterBtn">Filter</button>
          <button class="btn btn-outline" id="khataDownloadBtn" title="Download as CSV">
            <i data-icon="download" data-icon-size="16"></i> Download
          </button>
        </div>
      </div>

      <div id="khataTable" class="khata-table"></div>

      <style>
        .khata-header { padding: 20px; background: var(--surface); border-radius: 8px; margin-bottom: 20px; }
        .khata-controls { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 15px; }
        .control-group { display: flex; flex-direction: column; gap: 6px; }
        .control-group label { font-size: 0.8rem; font-weight: 600; color: var(--muted); }
        .control-group input,
        .control-group select { padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; font-size: 0.9rem; }

        .khata-table { margin-top: 20px; }
        .khata-table table { width: 100%; border-collapse: collapse; }
        .khata-table th {
          background: var(--surface);
          padding: 12px;
          text-align: left;
          font-weight: 600;
          border-bottom: 2px solid var(--line);
        }
        .khata-table td {
          padding: 12px;
          border-bottom: 1px solid var(--line);
        }
        .khata-table tr:hover { background: var(--bg-alt); }

        .khata-type {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 600;
        }
        .type-advance { background: #dbeafe; color: #1e40af; }
        .type-expense { background: #fef3c7; color: #92400e; }
        .type-settlement { background: #dcfce7; color: #166534; }

        .khata-amount { font-weight: 600; text-align: right; }
        .khata-summary {
          margin-top: 20px;
          padding: 15px;
          background: var(--surface);
          border-radius: 8px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 15px;
        }
        .summary-item { text-align: center; }
        .summary-label { font-size: 0.8rem; color: var(--muted); }
        .summary-value { font-size: 1.2rem; font-weight: 700; color: var(--navy); }
      </style>
    `;

    // Populate driver dropdown
    const drivers = (db.drivers || []).filter(d => d.name);
    const driverSelect = container.querySelector('#khataDriverFilter');
    drivers.forEach(d => {
      const option = document.createElement('option');
      option.value = d.id;
      option.textContent = d.name;
      driverSelect.appendChild(option);
    });
  },

  renderTable(container) {
    const { driverId, startDate, endDate } = this.currentFilter;
    const ledger = (db.driverLedger || []);
    const drivers = (db.drivers || []);

    // Filter ledger
    let filtered = ledger;
    if (driverId) {
      filtered = filtered.filter(l => l.driverId === driverId);
    }
    if (startDate) {
      filtered = filtered.filter(l => l.date >= startDate);
    }
    if (endDate) {
      filtered = filtered.filter(l => l.date <= endDate);
    }

    // Sort by date descending
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Calculate summary
    const totals = {
      advance: filtered.filter(l => l.type === 'advance').reduce((sum, l) => sum + (l.amount || 0), 0),
      expense: filtered.filter(l => l.type === 'expense').reduce((sum, l) => sum + (l.amount || 0), 0),
      settlement: filtered.filter(l => l.type === 'settlement').reduce((sum, l) => sum + (l.amount || 0), 0),
    };
    const netBalance = totals.advance - totals.expense - totals.settlement;

    // Build table
    let html = `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Driver</th>
            <th>Type</th>
            <th>Amount (₹)</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
    `;

    if (filtered.length === 0) {
      html += `<tr><td colspan="5" style="text-align:center; padding: 30px; color: var(--muted);">No entries found</td></tr>`;
    } else {
      filtered.forEach(entry => {
        const driver = drivers.find(d => d.id === entry.driverId);
        const typeClass = `type-${entry.type}`;
        const dateObj = new Date(entry.date);
        const dateStr = dateObj.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });

        html += `
          <tr>
            <td>${dateStr}</td>
            <td><strong>${driver?.name || 'Unknown'}</strong></td>
            <td><span class="khata-type ${typeClass}">${(entry.type || 'other').toUpperCase()}</span></td>
            <td class="khata-amount">₹${(entry.amount || 0).toLocaleString('en-IN')}</td>
            <td>${entry.note || '-'}</td>
          </tr>
        `;
      });
    }

    html += `
        </tbody>
      </table>

      <div class="khata-summary">
        <div class="summary-item">
          <div class="summary-label">Total Advances</div>
          <div class="summary-value" style="color: #1e40af;">₹${totals.advance.toLocaleString('en-IN')}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Total Expenses</div>
          <div class="summary-value" style="color: #92400e;">₹${totals.expense.toLocaleString('en-IN')}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Total Settlements</div>
          <div class="summary-value" style="color: #166534;">₹${totals.settlement.toLocaleString('en-IN')}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Net Balance</div>
          <div class="summary-value" style="color: ${netBalance >= 0 ? '#166534' : '#dc2626'};">₹${netBalance.toLocaleString('en-IN')}</div>
        </div>
      </div>
    `;

    const tableContainer = container.querySelector('#khataTable');
    if (tableContainer) tableContainer.innerHTML = html;
  },

  attachEventListeners(container) {
    const filterBtn = container.querySelector('#khataFilterBtn');
    const downloadBtn = container.querySelector('#khataDownloadBtn');
    const driverFilter = container.querySelector('#khataDriverFilter');
    const startDateInput = container.querySelector('#khataStartDate');
    const endDateInput = container.querySelector('#khataEndDate');

    filterBtn?.addEventListener('click', () => {
      this.currentFilter = {
        driverId: driverFilter.value || null,
        startDate: startDateInput.value || null,
        endDate: endDateInput.value || null,
      };
      this.renderTable(container);
    });

    downloadBtn?.addEventListener('click', () => this.downloadKhata());

    // Auto-filter on date change
    startDateInput?.addEventListener('change', () => filterBtn?.click());
    endDateInput?.addEventListener('change', () => filterBtn?.click());
  },

  downloadKhata() {
    const { driverId, startDate, endDate } = this.currentFilter;
    const ledger = (db.driverLedger || []);
    const drivers = (db.drivers || []);

    let filtered = ledger;
    if (driverId) filtered = filtered.filter(l => l.driverId === driverId);
    if (startDate) filtered = filtered.filter(l => l.date >= startDate);
    if (endDate) filtered = filtered.filter(l => l.date <= endDate);
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    // CSV format
    let csv = 'Date,Driver,Type,Amount (₹),Notes\n';
    filtered.forEach(entry => {
      const driver = drivers.find(d => d.id === entry.driverId);
      const dateStr = new Date(entry.date).toLocaleDateString('en-IN');
      csv += `"${dateStr}","${driver?.name || 'Unknown'}","${entry.type}",${entry.amount || 0},"${(entry.note || '').replace(/"/g, '""')}"\n`;
    });

    // Calculate totals
    const totals = {
      advance: filtered.filter(l => l.type === 'advance').reduce((sum, l) => sum + (l.amount || 0), 0),
      expense: filtered.filter(l => l.type === 'expense').reduce((sum, l) => sum + (l.amount || 0), 0),
      settlement: filtered.filter(l => l.type === 'settlement').reduce((sum, l) => sum + (l.amount || 0), 0),
    };
    const netBalance = totals.advance - totals.expense - totals.settlement;

    csv += '\n\nSummary\n';
    csv += `Total Advances,${totals.advance}\n`;
    csv += `Total Expenses,${totals.expense}\n`;
    csv += `Total Settlements,${totals.settlement}\n`;
    csv += `Net Balance,${netBalance}\n`;

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const fileName = `Driver_Khata_${new Date().toISOString().split('T')[0]}.csv`;
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log('✅ Khata downloaded:', fileName);
  }
};

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => DriverKhataController.init(), 1000);
  });
} else {
  setTimeout(() => DriverKhataController.init(), 1000);
}

window.DriverKhataController = DriverKhataController;
