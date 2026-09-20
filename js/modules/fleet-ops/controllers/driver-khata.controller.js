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
  drivers: [], // Store loaded drivers here

  init() {
    const container = document.getElementById('khataContainer');
    if (!container) return;

    // Get user role (from SupabaseAuth or demo user)
    const user = window.supabaseUser || { user_metadata: { role: 'owner' } };
    const userRole = user.user_metadata?.role || 'owner';

    // If driver, auto-filter to their ledger
    if (userRole === 'driver') {
      const drivers = (db.drivers || []);
      const currentDriver = drivers.find(d => d.email === user.email || d.id === user.id);
      if (currentDriver) {
        this.currentFilter.driverId = currentDriver.id;
        this.isDriverView = true;
      }
    }

    // Build UI (async renderFilters)
    this.renderFilters(container).then(() => {
      this.renderTable(container);
      this.attachEventListeners(container);
      console.log('✅ Driver Khata initialized (role: ' + userRole + ')');
    });
  },

  async renderFilters(container) {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get user role and driver info
    const user = window.supabaseUser || { user_metadata: { role: 'owner' } };
    const userRole = user.user_metadata?.role || 'owner';

    // Load drivers from Supabase or demo fallback
    let drivers = [];
    let datasource = 'demo';

    // ALWAYS load from Supabase (no fallback)
    if (!window.supabase || !window.supabase.from) {
      console.error('❌ Supabase not available');
      container.innerHTML = '<div style="padding: 20px; color: red;"><strong>Error:</strong> Supabase not connected. Reload page.</div>';
      return;
    }

    try {
      console.log('📡 Loading drivers from Supabase...');
      const { data, error } = await window.supabase.from('drivers').select('*');

      if (error) {
        console.error('❌ Supabase error:', error.code, '-', error.message);
        container.innerHTML = `<div style="padding: 20px; color: red; font-family: monospace;">
          <strong>Error:</strong> ${error.message}<br/>
          <small>Code: ${error.code}</small><br/>
          Check browser console for details.
        </div>`;
        return;
      }

      if (!data || data.length === 0) {
        console.warn('⚠️ No drivers in database');
        container.innerHTML = '<div style="padding: 20px; color: orange;"><strong>No drivers found.</strong> Add drivers to your account first.</div>';
        return;
      }

      drivers = data.filter(d => d && d.name);
      this.drivers = drivers; // Store for use in renderTable
      console.log('✅ Loaded', drivers.length, 'drivers:', drivers.map(d => d.name).join(', '));
    } catch (e) {
      console.error('❌ Exception:', e.message);
      container.innerHTML = `<div style="padding: 20px; color: red;"><strong>Error:</strong> ${e.message}</div>`;
      return;
    }

    const currentDriver = drivers.find(d => d.email === user.email || d.id === user.id);

    // Build driver dropdown or show driver name
    let driverControl = '';
    if (userRole === 'driver' && currentDriver) {
      driverControl = `
        <div class="control-group">
          <label>My Ledger</label>
          <div style="padding: 8px 12px; background: var(--bg-alt); border-radius: 6px; font-weight: 500;">
            ${currentDriver.name}
          </div>
        </div>
      `;
    } else {
      driverControl = `
        <div class="control-group">
          <label>Driver</label>
          <select id="khataDriverFilter">
            <option value="">All Drivers</option>
          </select>
        </div>
      `;
    }

    const title = userRole === 'driver' && currentDriver
      ? `My Khata - ${currentDriver.name}`
      : 'Driver Khata (Ledger)';

    container.innerHTML = `
      <div class="khata-header">
        <h2>${title}</h2>

        <!-- Add Expense Form (visible to drivers) -->
        ${userRole === 'driver' ? `
          <div class="expense-form-section" style="margin-top: 20px; padding: 15px; background: var(--bg-alt); border-radius: 8px;">
            <h3 style="margin: 0 0 15px 0;">Add Expense</h3>
            <form id="khataExpenseForm" class="khata-expense-form">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                <div class="form-group">
                  <label>Amount (₹)</label>
                  <input type="number" id="expenseAmount" name="amount" min="0" placeholder="0" required />
                </div>
                <div class="form-group">
                  <label>Type</label>
                  <select id="expenseType" name="type" required>
                    <option value="">Select type</option>
                    <option value="expense">Expense</option>
                    <option value="advance">Advance Request</option>
                  </select>
                </div>
              </div>
              <div class="form-group" style="margin-bottom: 12px;">
                <label>Description/Notes</label>
                <input type="text" id="expenseNote" name="note" placeholder="e.g., Diesel, Food, Toll..." />
              </div>
              <div class="form-group" style="margin-bottom: 12px;">
                <label>Bill/Receipt Photo</label>
                <div style="display: flex; gap: 8px;">
                  <input type="file" id="expensePhoto" name="photo" accept="image/*" style="flex: 1;" />
                  <button type="button" class="btn btn-outline" id="cameraBtn" title="Take photo with camera">
                    <i data-icon="camera" data-icon-size="16"></i> Camera
                  </button>
                </div>
                <div id="photoPreview" style="margin-top: 10px;"></div>
              </div>
              <button type="submit" class="btn btn-primary btn-block">Add to Khata</button>
            </form>
          </div>
        ` : ''}

        <div class="khata-controls">
          ${driverControl}
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

    // Populate driver dropdown (only if not driver view)
    const driverSelect = container.querySelector('#khataDriverFilter');
    if (driverSelect) {
      const driverOptions = drivers.filter(d => d.name && d.id);
      console.log('Adding', driverOptions.length, 'drivers to dropdown');
      driverOptions.forEach(d => {
        const option = document.createElement('option');
        option.value = d.id;
        option.textContent = d.name;
        driverSelect.appendChild(option);
      });
      if (driverOptions.length === 0) {
        const noOption = document.createElement('option');
        noOption.textContent = 'No drivers found';
        noOption.disabled = true;
        driverSelect.appendChild(noOption);
      }
    }
  },

  renderTable(container) {
    const { driverId, startDate, endDate } = this.currentFilter;
    const ledger = (db.driverLedger || []);
    const drivers = this.drivers || (db.drivers || []); // Use stored drivers from Supabase

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

        const hasPhoto = entry.photo ? '📎' : '';
        html += `
          <tr>
            <td>${dateStr}</td>
            <td><strong>${driver?.name || 'Unknown'}</strong></td>
            <td>
              <span class="khata-type ${typeClass}">${(entry.type || 'other').toUpperCase()}</span>
              ${entry.status === 'pending' ? '<span class="khata-type" style="background: #fca5a5; color: #7f1d1d; margin-left: 8px;">PENDING</span>' : ''}
            </td>
            <td class="khata-amount">₹${(entry.amount || 0).toLocaleString('en-IN')}</td>
            <td>${entry.note || '-'} ${hasPhoto}</td>
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

    // Filter functionality
    filterBtn?.addEventListener('click', () => {
      this.currentFilter = {
        driverId: driverFilter?.value || null,
        startDate: startDateInput.value || null,
        endDate: endDateInput.value || null,
      };
      this.renderTable(container);
    });

    downloadBtn?.addEventListener('click', () => this.downloadKhata());

    // Auto-filter on date change
    startDateInput?.addEventListener('change', () => filterBtn?.click());
    endDateInput?.addEventListener('change', () => filterBtn?.click());

    // Expense form handling (for drivers only)
    const expenseForm = container.querySelector('#khataExpenseForm');
    if (expenseForm) {
      const photoInput = container.querySelector('#expensePhoto');
      const cameraBtn = container.querySelector('#cameraBtn');
      const photoPreview = container.querySelector('#photoPreview');

      // Camera button
      cameraBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        photoInput.click();
      });

      // Photo preview
      photoInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            photoPreview.innerHTML = `
              <img src="${event.target.result}" style="max-width: 100%; max-height: 150px; border-radius: 6px; border: 1px solid var(--line);" />
              <p style="font-size: 0.8rem; color: var(--muted); margin: 8px 0 0 0;">Photo ready to upload</p>
            `;
          };
          reader.readAsDataURL(file);
        }
      });

      // Form submission
      expenseForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitExpense(e.target, container);
      });
    }
  },

  submitExpense(form, container) {
    const amount = parseFloat(form.querySelector('#expenseAmount').value);
    const type = form.querySelector('#expenseType').value;
    const note = form.querySelector('#expenseNote').value;
    const photoInput = form.querySelector('#expensePhoto');

    if (!amount || amount <= 0 || !type) {
      alert('Please fill in amount and type');
      return;
    }

    // Get current driver ID
    const user = window.supabaseUser || {};
    const drivers = (db.drivers || []);
    const currentDriver = drivers.find(d => d.email === user.email || d.id === user.id);

    if (!currentDriver) {
      alert('Driver information not found');
      return;
    }

    // Create expense entry
    const expense = {
      id: this.generateId(),
      driverId: currentDriver.id,
      date: new Date().toISOString().split('T')[0],
      type: type,
      amount: amount,
      note: note || '',
      photo: null,
      status: 'pending', // pending approval from admin
      createdAt: new Date().toISOString()
    };

    // Handle photo if provided
    if (photoInput.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        expense.photo = event.target.result; // Store as base64
        this.saveExpense(expense, form, container);
      };
      reader.readAsDataURL(photoInput.files[0]);
    } else {
      this.saveExpense(expense, form, container);
    }
  },

  saveExpense(expense, form, container) {
    // Add to driverLedger
    if (!db.driverLedger) db.driverLedger = [];
    db.driverLedger.push(expense);

    // Save to localStorage
    saveStore();

    // Show success message
    alert(`✅ Expense added! Pending admin approval.\nAmount: ₹${expense.amount}`);

    // Reset form
    form.reset();
    container.querySelector('#photoPreview').innerHTML = '';

    // Refresh table
    this.renderTable(container);
  },

  generateId() {
    return 'exp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
