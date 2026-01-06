import * as vscode from 'vscode';
import { WebviewMessage, QueryResult } from '../types';

export class QueryPanel {
  public static currentPanel: QueryPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly onQuery: (query: string) => Promise<{ sql: string; result: QueryResult }>
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtmlContent();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        if (message.type === 'query' && typeof message.payload === 'string') {
          await this.handleQuery(message.payload);
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    onQuery: (query: string) => Promise<{ sql: string; result: QueryResult }>
  ): QueryPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (QueryPanel.currentPanel) {
      QueryPanel.currentPanel.panel.reveal(column);
      return QueryPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'postgresAgentQuery',
      'PostgreSQL Agent',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    QueryPanel.currentPanel = new QueryPanel(panel, extensionUri, onQuery);
    return QueryPanel.currentPanel;
  }

  private async handleQuery(query: string): Promise<void> {
    this.sendMessage({ type: 'status', payload: 'Generating SQL...' });

    try {
      const { sql, result } = await this.onQuery(query);
      this.sendMessage({ type: 'sql', payload: sql });
      this.sendMessage({ type: 'result', payload: result });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendMessage({ type: 'error', payload: errorMessage });
    }
  }

  private sendMessage(message: WebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  public updateConnectionStatus(connected: boolean, info?: string): void {
    this.sendMessage({
      type: 'status',
      payload: connected ? `Connected: ${info}` : 'Not connected',
    });
  }

  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PostgreSQL Agent</title>
  <style>
    :root {
      --vscode-font-family: var(--vscode-editor-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      margin: 0;
    }

    h1 {
      font-size: 1.5em;
      margin-bottom: 10px;
      color: var(--vscode-foreground);
    }

    .status-bar {
      padding: 8px 12px;
      background-color: var(--vscode-statusBar-background);
      color: var(--vscode-statusBar-foreground);
      border-radius: 4px;
      margin-bottom: 16px;
      font-size: 0.9em;
    }

    .query-section {
      margin-bottom: 20px;
    }

    .query-input {
      width: 100%;
      min-height: 80px;
      padding: 12px;
      font-size: 14px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      resize: vertical;
      font-family: inherit;
    }

    .query-input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }

    .query-input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .button-row {
      margin-top: 12px;
      display: flex;
      gap: 10px;
      align-items: center;
    }

    button {
      padding: 8px 16px;
      font-size: 14px;
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

    .sql-section {
      margin-bottom: 20px;
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

    .error-message {
      padding: 12px;
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
      border-radius: 4px;
      margin-bottom: 16px;
    }

    .results-section {
      margin-top: 20px;
    }

    .results-info {
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
    }

    .table-container {
      overflow-x: auto;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
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

    .pagination button {
      padding: 4px 8px;
      font-size: 12px;
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--vscode-descriptionForeground);
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--vscode-progressBar-background);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  <h1>PostgreSQL Agent</h1>

  <div class="status-bar" id="status">Initializing...</div>

  <div class="query-section">
    <textarea
      class="query-input"
      id="queryInput"
      placeholder="Ask a question about your database in plain English...&#10;&#10;Examples:&#10;• Show me all users who signed up last week&#10;• What are the top 10 products by sales?&#10;• List all orders with their customer names"
    ></textarea>
    <div class="button-row">
      <button id="runButton">Run Query</button>
      <div class="loading hidden" id="loading">
        <div class="spinner"></div>
        <span id="loadingText">Processing...</span>
      </div>
    </div>
  </div>

  <div class="error-message hidden" id="error"></div>

  <div class="sql-section hidden" id="sqlSection">
    <div class="sql-toggle" id="sqlToggle">
      <span id="sqlArrow">▼</span> Generated SQL
    </div>
    <pre class="sql-content" id="sqlContent"></pre>
  </div>

  <div class="results-section hidden" id="resultsSection">
    <div class="results-info" id="resultsInfo"></div>
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
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // State
    let currentResults = null;
    let currentPage = 0;
    const pageSize = 50;
    let sqlVisible = true;
    let sortColumn = -1;
    let sortAsc = true;

    // Elements
    const queryInput = document.getElementById('queryInput');
    const runButton = document.getElementById('runButton');
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loadingText');
    const status = document.getElementById('status');
    const error = document.getElementById('error');
    const sqlSection = document.getElementById('sqlSection');
    const sqlToggle = document.getElementById('sqlToggle');
    const sqlArrow = document.getElementById('sqlArrow');
    const sqlContent = document.getElementById('sqlContent');
    const resultsSection = document.getElementById('resultsSection');
    const resultsInfo = document.getElementById('resultsInfo');
    const tableHead = document.getElementById('tableHead');
    const tableBody = document.getElementById('tableBody');
    const pagination = document.getElementById('pagination');
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');

    // Event Listeners
    runButton.addEventListener('click', runQuery);
    queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        runQuery();
      }
    });

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
      const totalPages = Math.ceil(currentResults.rows.length / pageSize);
      if (currentPage < totalPages - 1) {
        currentPage++;
        renderTable();
      }
    });

    function runQuery() {
      const query = queryInput.value.trim();
      if (!query) return;

      setLoading(true);
      hideError();
      sqlSection.classList.add('hidden');
      resultsSection.classList.add('hidden');

      vscode.postMessage({ type: 'query', payload: query });
    }

    function setLoading(isLoading, text = 'Processing...') {
      loading.classList.toggle('hidden', !isLoading);
      loadingText.textContent = text;
      runButton.disabled = isLoading;
    }

    function showError(message) {
      error.textContent = message;
      error.classList.remove('hidden');
    }

    function hideError() {
      error.classList.add('hidden');
    }

    function renderTable() {
      if (!currentResults || !currentResults.rows.length) {
        tableHead.innerHTML = '';
        tableBody.innerHTML = '<tr><td>No results</td></tr>';
        pagination.classList.add('hidden');
        return;
      }

      const rows = [...currentResults.rows];

      // Sort if needed
      if (sortColumn >= 0 && currentResults.columns[sortColumn]) {
        const col = currentResults.columns[sortColumn];
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
      tableHead.innerHTML = '<tr>' + currentResults.columns.map((col, i) =>
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
        '<tr>' + currentResults.columns.map(col =>
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

    // Message handler
    window.addEventListener('message', (event) => {
      const message = event.data;

      switch (message.type) {
        case 'status':
          status.textContent = message.payload;
          if (message.payload === 'Generating SQL...') {
            setLoading(true, 'Generating SQL...');
          } else if (message.payload.startsWith('Executing')) {
            setLoading(true, 'Executing query...');
          }
          break;

        case 'sql':
          sqlContent.textContent = message.payload;
          sqlSection.classList.remove('hidden');
          setLoading(true, 'Executing query...');
          break;

        case 'result':
          setLoading(false);
          currentResults = message.payload;
          currentPage = 0;
          sortColumn = -1;

          resultsInfo.textContent = currentResults.rowCount + ' rows returned in ' + currentResults.executionTime + 'ms';
          resultsSection.classList.remove('hidden');
          renderTable();
          break;

        case 'error':
          setLoading(false);
          showError(message.payload);
          break;
      }
    });

    // Initial status
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    QueryPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
