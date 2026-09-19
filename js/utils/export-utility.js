/**
 * Universal Export Utility
 * Export data to CSV, Excel, JSON, and PDF formats
 */

const ExportUtility = {
  // Export to CSV
  exportToCSV(data, filename = 'export.csv') {
    if (!data || data.length === 0) {
      alert('No data to export');
      return;
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row =>
        headers.map(header => {
          const value = row[header];
          if (value === null || value === undefined) return '';
          if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(',')
      )
    ].join('\n');

    this._downloadFile(csvContent, filename, 'text/csv');
  },

  // Export to JSON
  exportToJSON(data, filename = 'export.json') {
    if (!data || data.length === 0) {
      alert('No data to export');
      return;
    }

    const jsonContent = JSON.stringify(data, null, 2);
    this._downloadFile(jsonContent, filename, 'application/json');
  },

  // Export to Excel (XLSX format using SheetJS)
  async exportToExcel(data, filename = 'export.xlsx', sheetName = 'Data') {
    if (!data || data.length === 0) {
      alert('No data to export');
      return;
    }

    // Load SheetJS from CDN
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js';

    script.onload = () => {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, filename);
    };

    document.head.appendChild(script);
  },

  // Export to PDF
  async exportToPDF(data, filename = 'export.pdf', title = 'Export Report') {
    if (!data || data.length === 0) {
      alert('No data to export');
      return;
    }

    const headers = Object.keys(data[0]);
    let htmlContent = `
      <h1>${title}</h1>
      <p>Generated on: ${new Date().toLocaleString('en-IN')}</p>
      <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
        <thead>
          <tr style="background-color:#0f1e33;color:white;">
            ${headers.map(h => `<th>${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.map(row => `
            <tr>
              ${headers.map(h => `<td>${row[h] || ''}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Load html2pdf from CDN
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

    script.onload = () => {
      const opt = {
        margin: 10,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
      };

      html2pdf().set(opt).from.string(htmlContent).save();
    };

    document.head.appendChild(script);
  },

  // Export table as PDF with formatting
  exportTableToPDF(tableElement, filename = 'table-export.pdf') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

    script.onload = () => {
      const opt = {
        margin: 10,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
      };

      html2pdf().set(opt).from(tableElement).save();
    };

    document.head.appendChild(script);
  },

  // Create export menu button
  createExportMenu(data, baseFilename = 'export') {
    const menu = document.createElement('div');
    menu.style.cssText = `
      display: inline-block;
      position: relative;
    `;

    const button = document.createElement('button');
    button.textContent = '⬇️ Export';
    button.style.cssText = `
      padding: 8px 16px;
      background: #0f1e33;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.95rem;
    `;

    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      display: none;
      position: absolute;
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      min-width: 150px;
      z-index: 1000;
      top: 100%;
      right: 0;
    `;

    const options = [
      { label: '📄 CSV', action: () => this.exportToCSV(data, `${baseFilename}.csv`) },
      { label: '📊 Excel', action: () => this.exportToExcel(data, `${baseFilename}.xlsx`) },
      { label: '📋 JSON', action: () => this.exportToJSON(data, `${baseFilename}.json`) },
      { label: '📑 PDF', action: () => this.exportToPDF(data, `${baseFilename}.pdf`) }
    ];

    options.forEach(option => {
      const link = document.createElement('a');
      link.textContent = option.label;
      link.style.cssText = `
        display: block;
        padding: 10px 16px;
        color: #1e293b;
        text-decoration: none;
        cursor: pointer;
        border-bottom: 1px solid #e2e8f0;
        transition: background 0.2s;
      `;
      link.onmouseover = () => link.style.background = '#f8fafc';
      link.onmouseout = () => link.style.background = 'transparent';
      link.onclick = () => {
        option.action();
        dropdown.style.display = 'none';
      };
      dropdown.appendChild(link);
    });

    button.onclick = () => {
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    };

    menu.appendChild(button);
    menu.appendChild(dropdown);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    return menu;
  },

  // Helper: Download file
  _downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
};

// Make globally available
window.ExportUtility = ExportUtility;
