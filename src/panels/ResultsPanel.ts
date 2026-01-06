import * as vscode from 'vscode';
import { QueryResult } from '../types';

export class ResultsPanel {
  private static panels: Map<string, ResultsPanel> = new Map();
  private static panelCounter = 0;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private readonly panelId: string;

  private constructor(
    panel: vscode.WebviewPanel,
    panelId: string,
    sql: string,
    result: QueryResult
  ) {
    this.panel = panel;
    this.panelId = panelId;
    this.panel.webview.html = this.getHtmlContent(sql, result);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static show(sql: string, result: QueryResult): ResultsPanel {
    ResultsPanel.panelCounter++;
    const panelId = `results-${ResultsPanel.panelCounter}`;

    // Create panel in a new column beside the current one
    const column = vscode.ViewColumn.Beside;

    const panel = vscode.window.createWebviewPanel(
      'postgresAgentResults',
      `Results #${ResultsPanel.panelCounter}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    const resultsPanel = new ResultsPanel(panel, panelId, sql, result);
    ResultsPanel.panels.set(panelId, resultsPanel);
    return resultsPanel;
  }

  private getHtmlContent(sql: string, result: QueryResult): string {
    const escapedSql = this.escapeHtml(sql);
    const columnsJson = JSON.stringify(result.columns);
    const rowsJson = JSON.stringify(result.rows);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Query Results</title>
  <style>
    :root {
      --vscode-font-family: var(--vscode-editor-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family);
      padding: 16px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      margin: 0;
    }

    h2 {
      font-size: 1.2em;
      margin: 0 0 12px 0;
      color: var(--vscode-foreground);
    }

    .results-info {
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .sql-section {
      margin-bottom: 16px;
    }

    .sql-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 0.9em;
      color: var(--vscode-textLink-foreground);
      margin-bottom: 8px;
    }

    .sql-toggle:hover {
      text-decoration: underline;
    }

    .sql-content {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .sql-content.hidden {
      display: none;
    }

    .table-container {
      overflow-x: auto;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    th, td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    th {
      background-color: var(--vscode-editor-lineHighlightBackground);
      font-weight: 600;
      position: sticky;
      top: 0;
      cursor: pointer;
      z-index: 1;
    }

    th:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    tr:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .pagination {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
      font-size: 0.9em;
    }

    button {
      padding: 6px 12px;
      font-size: 13px;
      cursor: pointer;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      font-family: inherit;
    }

    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .hidden {
      display: none !important;
    }

    .no-results {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }

    .export-btn {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .export-btn:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <div class="results-info">
    <span id="resultsInfo">${result.rowCount} rows returned in ${result.executionTime}ms</span>
    <button class="export-btn" id="exportBtn">Export CSV</button>
  </div>

  <div class="sql-section">
    <div class="sql-toggle" id="sqlToggle">
      <span id="sqlArrow">▶</span> SQL Query
    </div>
    <pre class="sql-content hidden" id="sqlContent">${escapedSql}</pre>
  </div>

  <div class="table-container">
    <table id="resultsTable">
      <thead id="tableHead"></thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>

  <div class="pagination" id="pagination">
    <button id="prevPage">Previous</button>
    <span id="pageInfo">Page 1</span>
    <button id="nextPage">Next</button>
  </div>

  <script>
    const columns = ${columnsJson};
    const allRows = ${rowsJson};

    let currentPage = 0;
    const pageSize = 100;
    let sortColumn = -1;
    let sortAsc = true;
    let sqlVisible = false;

    const sqlToggle = document.getElementById('sqlToggle');
    const sqlArrow = document.getElementById('sqlArrow');
    const sqlContent = document.getElementById('sqlContent');
    const tableHead = document.getElementById('tableHead');
    const tableBody = document.getElementById('tableBody');
    const pagination = document.getElementById('pagination');
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');
    const exportBtn = document.getElementById('exportBtn');

    sqlToggle.addEventListener('click', () => {
      sqlVisible = !sqlVisible;
      sqlContent.classList.toggle('hidden', !sqlVisible);
      sqlArrow.textContent = sqlVisible ? '▼' : '▶';
    });

    prevPage.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage--;
        renderTable();
      }
    });

    nextPage.addEventListener('click', () => {
      const totalPages = Math.ceil(allRows.length / pageSize);
      if (currentPage < totalPages - 1) {
        currentPage++;
        renderTable();
      }
    });

    exportBtn.addEventListener('click', () => {
      exportCsv();
    });

    function renderTable() {
      if (!allRows.length) {
        tableHead.innerHTML = '';
        tableBody.innerHTML = '<tr><td class="no-results">No results</td></tr>';
        pagination.classList.add('hidden');
        return;
      }

      const rows = [...allRows];

      // Sort if needed
      if (sortColumn >= 0 && columns[sortColumn]) {
        const col = columns[sortColumn];
        rows.sort((a, b) => {
          const aVal = a[col];
          const bVal = b[col];
          if (aVal === bVal) return 0;
          if (aVal === null) return 1;
          if (bVal === null) return -1;
          const cmp = aVal < bVal ? -1 : 1;
          return sortAsc ? cmp : -cmp;
        });
      }

      // Render header
      tableHead.innerHTML = '<tr>' + columns.map((col, i) =>
        '<th data-col="' + i + '">' + escapeHtml(col) + (sortColumn === i ? (sortAsc ? ' ↑' : ' ↓') : '') + '</th>'
      ).join('') + '</tr>';

      // Add sort click handlers
      tableHead.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
          const col = parseInt(th.dataset.col);
          if (sortColumn === col) {
            sortAsc = !sortAsc;
          } else {
            sortColumn = col;
            sortAsc = true;
          }
          renderTable();
        });
      });

      // Paginate
      const start = currentPage * pageSize;
      const end = start + pageSize;
      const pageRows = rows.slice(start, end);

      // Render body
      tableBody.innerHTML = pageRows.map(row =>
        '<tr>' + columns.map(col =>
          '<td>' + escapeHtml(formatValue(row[col])) + '</td>'
        ).join('') + '</tr>'
      ).join('');

      // Update pagination
      const totalPages = Math.ceil(rows.length / pageSize);
      pageInfo.textContent = 'Page ' + (currentPage + 1) + ' of ' + totalPages;
      prevPage.disabled = currentPage === 0;
      nextPage.disabled = currentPage >= totalPages - 1;
      pagination.classList.toggle('hidden', totalPages <= 1);
    }

    function formatValue(val) {
      if (val === null) return 'NULL';
      if (val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function exportCsv() {
      const csvRows = [];
      // Header
      csvRows.push(columns.map(col => '"' + col.replace(/"/g, '""') + '"').join(','));
      // Data
      allRows.forEach(row => {
        csvRows.push(columns.map(col => {
          const val = formatValue(row[col]);
          return '"' + val.replace(/"/g, '""') + '"';
        }).join(','));
      });

      const csvContent = csvRows.join('\\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'query-results.csv';
      a.click();
      URL.revokeObjectURL(url);
    }

    // Initial render
    renderTable();
  </script>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  public dispose(): void {
    ResultsPanel.panels.delete(this.panelId);
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
