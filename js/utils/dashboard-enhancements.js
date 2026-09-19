/**
 * Dashboard Enhancements
 * Automatically adds export buttons and features to all dashboards
 */

const DashboardEnhancements = {
  // Auto-enhance dashboard sections
  enhanceAllDashboards() {
    console.log('Enhancing dashboards with export & features...');
    this.addExportButtonsToDashboards();
    this.addTableExports();
    this.enhanceKPICards();
  },

  // Add export buttons to major dashboard sections
  addExportButtonsToDashboards() {
    const dashboardSections = document.querySelectorAll('[data-section], .section, [class*="dashboard"]');

    dashboardSections.forEach((section, index) => {
      const title = section.querySelector('h2, h3');
      if (!title) return;

      const sectionName = title.textContent.trim();
      if (sectionName.includes('Summary') || sectionName.includes('Overview') || sectionName.includes('Analytics')) {
        this.addExportMenuToSection(section, sectionName);
      }
    });
  },

  // Add export menu to a section
  addExportMenuToSection(section, sectionName) {
    const header = section.querySelector('h2, h3');
    if (!header) return;

    const exportBtn = document.createElement('button');
    exportBtn.innerHTML = '⬇️ Export Data';
    exportBtn.style.cssText = `
      margin-left: 12px;
      padding: 8px 16px;
      background: #0f1e33;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
      transition: all 0.2s;
    `;
    exportBtn.onmouseover = () => exportBtn.style.background = '#1e2740';
    exportBtn.onmouseout = () => exportBtn.style.background = '#0f1e33';

    // Extract table data and export
    exportBtn.onclick = () => {
      const table = section.querySelector('table');
      const cards = section.querySelectorAll('[data-kpi], .feature-card, .card');

      if (table) {
        const data = this.extractTableData(table);
        ExportUtility.exportToCSV(data, `${sectionName.replace(/\s+/g, '-')}.csv`);
      } else if (cards.length > 0) {
        const data = this.extractCardData(cards);
        ExportUtility.exportToCSV(data, `${sectionName.replace(/\s+/g, '-')}.csv`);
      }
    };

    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.appendChild(exportBtn);
  },

  // Extract data from HTML table
  extractTableData(table) {
    const data = [];
    const headers = [];

    // Get headers
    const ths = table.querySelectorAll('thead th');
    ths.forEach(th => headers.push(th.textContent.trim()));

    // Get rows
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const rowData = {};
      const tds = row.querySelectorAll('td');
      tds.forEach((td, index) => {
        rowData[headers[index] || `Column ${index + 1}`] = td.textContent.trim();
      });
      data.push(rowData);
    });

    return data;
  },

  // Extract data from KPI/feature cards
  extractCardData(cards) {
    const data = [];

    cards.forEach(card => {
      const title = card.querySelector('h3, .title, strong');
      const values = card.querySelectorAll('[data-value], .value, .number');

      const row = {
        Name: title ? title.textContent.trim() : 'N/A'
      };

      values.forEach((val, index) => {
        row[`Value ${index + 1}`] = val.textContent.trim();
      });

      if (Object.keys(row).length > 1) {
        data.push(row);
      }
    });

    return data.length > 0 ? data : [{ Message: 'No data to export' }];
  },

  // Add export to all tables
  addTableExports() {
    const tables = document.querySelectorAll('table:not([data-exported])');

    tables.forEach(table => {
      table.setAttribute('data-exported', 'true');

      const wrapper = table.parentElement;
      const exportDiv = document.createElement('div');
      exportDiv.style.marginBottom = '12px';
      exportDiv.innerHTML = `
        <button class="export-table-btn" style="
          padding: 6px 12px;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9rem;
        ">
          📊 Export Table
        </button>
      `;

      exportDiv.querySelector('button').onclick = () => {
        const data = this.extractTableData(table);
        ExportUtility.exportToCSV(data, 'table-export.csv');
      };

      wrapper.insertBefore(exportDiv, table);
    });
  },

  // Enhance KPI cards with click-to-export
  enhanceKPICards() {
    const kpiCards = document.querySelectorAll('.feature-card, [class*="kpi"], [class*="metric"]');

    kpiCards.forEach(card => {
      const value = card.querySelector('[data-value], .value, strong');
      if (value && !card.hasAttribute('data-enhanced')) {
        card.setAttribute('data-enhanced', 'true');
        card.title = 'Click to export this metric';
        card.style.cursor = 'pointer';

        card.onclick = (e) => {
          e.stopPropagation();
          const title = card.querySelector('h3, .title') || card.firstChild;
          const data = [{
            Metric: title ? title.textContent.trim() : 'Value',
            Value: value.textContent.trim(),
            'Exported At': new Date().toLocaleString('en-IN')
          }];
          ExportUtility.exportToJSON(data, 'metric-export.json');
        };
      }
    });
  },

  // Add help tooltip to sections
  addHelpTooltips() {
    const sections = document.querySelectorAll('[data-section], .section');
    sections.forEach(section => {
      const h = section.querySelector('h2, h3');
      if (!h) return;

      const helpIcon = document.createElement('span');
      helpIcon.innerHTML = ' ❓';
      helpIcon.style.cssText = `
        cursor: help;
        font-size: 1.1rem;
        margin-left: 4px;
      `;
      helpIcon.title = 'Ask Virtual Assistant about this section';
      helpIcon.onclick = () => {
        const sectionName = h.textContent.trim();
        if (window.VirtualAssistant) {
          window.VirtualAssistant.isOpen = true;
          document.getElementById('va-panel').style.display = 'flex';
          document.getElementById('va-input').value = sectionName;
          window.VirtualAssistant.sendMessage();
        }
      };
      h.appendChild(helpIcon);
    });
  }
};

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      DashboardEnhancements.enhanceAllDashboards();
      DashboardEnhancements.addHelpTooltips();
    }, 1000);
  });
} else {
  setTimeout(() => {
    DashboardEnhancements.enhanceAllDashboards();
    DashboardEnhancements.addHelpTooltips();
  }, 1000);
}

window.DashboardEnhancements = DashboardEnhancements;
