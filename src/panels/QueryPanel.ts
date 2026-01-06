import * as vscode from 'vscode';
import { WebviewMessage, QueryResult, SqlVerificationResult, SqlValidationResult, ChatMessage } from '../types';

interface QueryResponse {
  sql: string;
  result?: QueryResult;
  verification?: SqlVerificationResult;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

interface ClarificationResponse {
  sql: string;
  result: QueryResult;
  verification?: SqlVerificationResult;
}

interface RunEditedSqlResponse {
  sql: string;
  result: QueryResult;
}

interface FixQueryResponse {
  sql: string;
  result: QueryResult;
}

export class QueryPanel {
  public static currentPanel: QueryPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private pendingClarificationQuery: string | null = null;
  private lastUserQuestion: string | null = null;
  private initialHistory: ChatMessage[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly onQuery: (query: string) => Promise<QueryResponse>,
    private readonly onClarification: (originalQuestion: string, clarificationAnswer: string) => Promise<ClarificationResponse>,
    private readonly onValidateSql: (sql: string) => Promise<SqlValidationResult>,
    private readonly onRunEditedSql: (sql: string) => Promise<RunEditedSqlResponse>,
    private readonly onFixQuery: (sql: string, error: string, originalQuestion: string) => Promise<FixQueryResponse>,
    private readonly onShowResults: (sql: string, result: QueryResult) => void,
    history: ChatMessage[] = []
  ) {
    this.panel = panel;
    this.initialHistory = history;
    this.panel.webview.html = this.getHtmlContent();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        if (message.type === 'ready') {
          // Send initial history when webview is ready
          if (this.initialHistory.length > 0) {
            this.sendMessage({ type: 'history' as WebviewMessage['type'], payload: this.initialHistory });
          }
        } else if (message.type === 'query' && typeof message.payload === 'string') {
          this.lastUserQuestion = message.payload;
          await this.handleQuery(message.payload);
        } else if (message.type === 'clarificationResponse' && typeof message.payload === 'string') {
          await this.handleClarificationResponse(message.payload);
        } else if (message.type === 'runEditedSql' && typeof message.payload === 'string') {
          await this.handleRunEditedSql(message.payload);
        } else if (message.type === 'fixQuery' && typeof message.payload === 'object' && message.payload !== null) {
          const payload = message.payload as { sql: string; error: string };
          await this.handleFixQuery(payload.sql, payload.error);
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    onQuery: (query: string) => Promise<QueryResponse>,
    onClarification: (originalQuestion: string, clarificationAnswer: string) => Promise<ClarificationResponse>,
    onValidateSql: (sql: string) => Promise<SqlValidationResult>,
    onRunEditedSql: (sql: string) => Promise<RunEditedSqlResponse>,
    onFixQuery: (sql: string, error: string, originalQuestion: string) => Promise<FixQueryResponse>,
    onShowResults: (sql: string, result: QueryResult) => void,
    initialHistory: ChatMessage[] = []
  ): QueryPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If panel exists, dispose it to create a new one with fresh history
    if (QueryPanel.currentPanel && initialHistory.length > 0) {
      QueryPanel.currentPanel.dispose();
    } else if (QueryPanel.currentPanel) {
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

    QueryPanel.currentPanel = new QueryPanel(panel, extensionUri, onQuery, onClarification, onValidateSql, onRunEditedSql, onFixQuery, onShowResults, initialHistory);
    return QueryPanel.currentPanel;
  }

  private async handleQuery(query: string): Promise<void> {
    this.sendMessage({ type: 'status', payload: 'Generating SQL...' });

    try {
      const response = await this.onQuery(query);

      // Check if clarification is needed
      if (response.needsClarification && response.clarificationQuestion) {
        this.pendingClarificationQuery = query;
        this.sendMessage({ type: 'sql', payload: response.sql });
        this.sendMessage({
          type: 'clarification',
          payload: {
            question: response.clarificationQuestion,
            originalSql: response.sql
          }
        });
        return;
      }

      // Send verification info if available
      if (response.verification) {
        this.sendMessage({ type: 'verification', payload: response.verification });
      }

      this.sendMessage({ type: 'sql', payload: response.sql });
      if (response.result) {
        // Show results in a new tab instead of inline
        this.onShowResults(response.sql, response.result);
        this.sendMessage({ type: 'status', payload: 'Query executed - results shown in new tab' });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendMessage({ type: 'error', payload: errorMessage });
    }
  }

  private async handleClarificationResponse(clarificationAnswer: string): Promise<void> {
    if (!this.pendingClarificationQuery) {
      this.sendMessage({ type: 'error', payload: 'No pending clarification request' });
      return;
    }

    this.sendMessage({ type: 'status', payload: 'Regenerating SQL with clarification...' });

    try {
      const response = await this.onClarification(this.pendingClarificationQuery, clarificationAnswer);
      this.pendingClarificationQuery = null;

      if (response.verification) {
        this.sendMessage({ type: 'verification', payload: response.verification });
      }

      this.sendMessage({ type: 'sql', payload: response.sql });
      // Show results in a new tab instead of inline
      this.onShowResults(response.sql, response.result);
      this.sendMessage({ type: 'status', payload: 'Query executed - results shown in new tab' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendMessage({ type: 'error', payload: errorMessage });
    }
  }

  private async handleRunEditedSql(sql: string): Promise<void> {
    this.sendMessage({ type: 'status', payload: 'Validating SQL...' });

    try {
      // First validate the SQL
      const validation = await this.onValidateSql(sql);

      if (!validation.isValid) {
        this.sendMessage({
          type: 'validationError',
          payload: {
            error: validation.error,
            sql: sql
          }
        });
        return;
      }

      this.sendMessage({ type: 'validationSuccess', payload: null });
      this.sendMessage({ type: 'status', payload: 'Executing SQL...' });

      // Execute the validated SQL
      const response = await this.onRunEditedSql(sql);
      this.onShowResults(response.sql, response.result);
      this.sendMessage({ type: 'status', payload: 'Query executed - results shown in new tab' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendMessage({ type: 'error', payload: errorMessage });
    }
  }

  private async handleFixQuery(sql: string, error: string): Promise<void> {
    this.sendMessage({ type: 'status', payload: 'Fixing SQL query...' });

    try {
      const originalQuestion = this.lastUserQuestion || 'Fix this SQL query';
      const response = await this.onFixQuery(sql, error, originalQuestion);

      this.sendMessage({ type: 'sql', payload: response.sql });
      this.onShowResults(response.sql, response.result);
      this.sendMessage({ type: 'status', payload: 'Query fixed and executed - results shown in new tab' });
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

    .sql-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .sql-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 0.9em;
      color: var(--vscode-textLink-foreground);
    }

    .sql-toggle:hover {
      text-decoration: underline;
    }

    .sql-editor {
      width: 100%;
      min-height: 120px;
      padding: 12px;
      background-color: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px;
      color: var(--vscode-foreground);
      resize: vertical;
      white-space: pre;
      overflow-x: auto;
    }

    .sql-editor:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }

    .sql-editor.hidden {
      display: none;
    }

    .sql-actions {
      display: flex;
      gap: 10px;
      margin-top: 12px;
      align-items: center;
    }

    .sql-actions.hidden {
      display: none;
    }

    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .validation-error {
      margin-top: 12px;
      padding: 12px;
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 4px;
    }

    .validation-error.hidden {
      display: none;
    }

    .validation-error-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--vscode-errorForeground);
      margin-bottom: 8px;
    }

    .validation-error-message {
      font-size: 0.9em;
      color: var(--vscode-foreground);
      margin-bottom: 12px;
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .validation-error-actions {
      display: flex;
      gap: 10px;
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

    .verification-section {
      margin-bottom: 16px;
      padding: 12px;
      border-radius: 4px;
      font-size: 0.9em;
    }

    .verification-section.valid {
      background-color: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
    }

    .verification-section.corrected {
      background-color: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
    }

    .verification-header {
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .verification-issues {
      margin-top: 8px;
      padding-left: 16px;
    }

    .verification-issues li {
      margin-bottom: 4px;
    }

    .clarification-section {
      margin-bottom: 16px;
      padding: 16px;
      background-color: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 4px;
    }

    .clarification-question {
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--vscode-foreground);
    }

    .clarification-input {
      width: 100%;
      padding: 10px;
      font-size: 14px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      margin-bottom: 12px;
    }

    .clarification-input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }

    .clarification-buttons {
      display: flex;
      gap: 10px;
    }

    .confidence-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.8em;
      font-weight: 500;
    }

    .confidence-high {
      background-color: var(--vscode-testing-iconPassed);
      color: var(--vscode-editor-background);
    }

    .confidence-medium {
      background-color: var(--vscode-editorWarning-foreground);
      color: var(--vscode-editor-background);
    }

    .confidence-low {
      background-color: var(--vscode-errorForeground);
      color: var(--vscode-editor-background);
    }

    .history-section {
      margin-bottom: 20px;
      max-height: 400px;
      overflow-y: auto;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }

    .history-section.hidden {
      display: none;
    }

    .history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background-color: var(--vscode-editor-lineHighlightBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-weight: 600;
      font-size: 0.9em;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .history-toggle {
      cursor: pointer;
      color: var(--vscode-textLink-foreground);
      font-size: 0.85em;
      font-weight: normal;
    }

    .history-toggle:hover {
      text-decoration: underline;
    }

    .history-messages {
      padding: 12px;
    }

    .history-messages.collapsed {
      display: none;
    }

    .history-message {
      padding: 8px 12px;
      margin-bottom: 8px;
      border-radius: 4px;
      font-size: 0.9em;
    }

    .history-message:last-child {
      margin-bottom: 0;
    }

    .history-message.user {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-left: 20%;
    }

    .history-message.assistant {
      background-color: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      margin-right: 20%;
    }

    .history-message.sql {
      background-color: var(--vscode-textCodeBlock-background);
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
      margin-right: 20%;
    }

    .history-message.result {
      background-color: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
      margin-right: 20%;
    }

    .history-message.error {
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
      margin-right: 20%;
    }

    .history-message-label {
      font-size: 0.75em;
      opacity: 0.7;
      margin-bottom: 4px;
      text-transform: uppercase;
    }

    .history-message-time {
      font-size: 0.7em;
      opacity: 0.5;
      float: right;
    }
  </style>
</head>
<body>
  <h1>PostgreSQL Agent</h1>

  <div class="status-bar" id="status">Initializing...</div>

  <div class="history-section hidden" id="historySection">
    <div class="history-header">
      <span>Chat History</span>
      <span class="history-toggle" id="historyToggle">Collapse</span>
    </div>
    <div class="history-messages" id="historyMessages"></div>
  </div>

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

  <div class="clarification-section hidden" id="clarificationSection">
    <div class="clarification-question" id="clarificationQuestion"></div>
    <input type="text" class="clarification-input" id="clarificationInput" placeholder="Type your answer here...">
    <div class="clarification-buttons">
      <button id="submitClarification">Submit</button>
      <button id="skipClarification">Run Anyway</button>
    </div>
  </div>

  <div class="verification-section hidden" id="verificationSection">
    <div class="verification-header">
      <span id="verificationIcon"></span>
      <span id="verificationStatus"></span>
      <span class="confidence-badge" id="confidenceBadge"></span>
    </div>
    <ul class="verification-issues hidden" id="verificationIssues"></ul>
  </div>

  <div class="sql-section hidden" id="sqlSection">
    <div class="sql-header">
      <div class="sql-toggle" id="sqlToggle">
        <span id="sqlArrow">▼</span> Generated SQL (editable)
      </div>
    </div>
    <textarea class="sql-editor" id="sqlEditor" spellcheck="false"></textarea>
    <div class="sql-actions" id="sqlActions">
      <button id="runSqlButton">Run SQL</button>
      <div class="loading hidden" id="sqlLoading">
        <div class="spinner"></div>
        <span id="sqlLoadingText">Validating...</span>
      </div>
    </div>
    <div class="validation-error hidden" id="validationError">
      <div class="validation-error-header">
        <span>SQL Validation Error</span>
      </div>
      <div class="validation-error-message" id="validationErrorMessage"></div>
      <div class="validation-error-actions">
        <button id="fixQueryButton">Fix Query</button>
        <button class="btn-secondary" id="dismissErrorButton">Dismiss</button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // State
    let sqlVisible = true;
    let currentValidationError = null;

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
    const sqlEditor = document.getElementById('sqlEditor');
    const sqlActions = document.getElementById('sqlActions');
    const runSqlButton = document.getElementById('runSqlButton');
    const sqlLoading = document.getElementById('sqlLoading');
    const sqlLoadingText = document.getElementById('sqlLoadingText');
    const validationError = document.getElementById('validationError');
    const validationErrorMessage = document.getElementById('validationErrorMessage');
    const fixQueryButton = document.getElementById('fixQueryButton');
    const dismissErrorButton = document.getElementById('dismissErrorButton');
    const clarificationSection = document.getElementById('clarificationSection');
    const clarificationQuestion = document.getElementById('clarificationQuestion');
    const clarificationInput = document.getElementById('clarificationInput');
    const submitClarification = document.getElementById('submitClarification');
    const skipClarification = document.getElementById('skipClarification');
    const verificationSection = document.getElementById('verificationSection');
    const verificationIcon = document.getElementById('verificationIcon');
    const verificationStatus = document.getElementById('verificationStatus');
    const confidenceBadge = document.getElementById('confidenceBadge');
    const verificationIssues = document.getElementById('verificationIssues');
    const historySection = document.getElementById('historySection');
    const historyMessages = document.getElementById('historyMessages');
    const historyToggle = document.getElementById('historyToggle');

    // History state
    let historyCollapsed = false;

    // Event Listeners
    runButton.addEventListener('click', runQuery);
    queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        runQuery();
      }
    });

    sqlToggle.addEventListener('click', () => {
      sqlVisible = !sqlVisible;
      sqlEditor.classList.toggle('hidden', !sqlVisible);
      sqlActions.classList.toggle('hidden', !sqlVisible);
      sqlArrow.textContent = sqlVisible ? '▼' : '▶';
    });

    runSqlButton.addEventListener('click', runEditedSql);
    sqlEditor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        runEditedSql();
      }
    });

    fixQueryButton.addEventListener('click', () => {
      if (currentValidationError) {
        setSqlLoading(true, 'Fixing query...');
        hideValidationError();
        vscode.postMessage({
          type: 'fixQuery',
          payload: {
            sql: sqlEditor.value,
            error: currentValidationError
          }
        });
      }
    });

    dismissErrorButton.addEventListener('click', () => {
      hideValidationError();
    });

    submitClarification.addEventListener('click', () => {
      const answer = clarificationInput.value.trim();
      if (!answer) return;

      clarificationSection.classList.add('hidden');
      setLoading(true, 'Regenerating SQL...');
      vscode.postMessage({ type: 'clarificationResponse', payload: answer });
      clarificationInput.value = '';
    });

    skipClarification.addEventListener('click', () => {
      clarificationSection.classList.add('hidden');
      setLoading(false);
    });

    clarificationInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        submitClarification.click();
      }
    });

    historyToggle.addEventListener('click', () => {
      historyCollapsed = !historyCollapsed;
      historyMessages.classList.toggle('collapsed', historyCollapsed);
      historyToggle.textContent = historyCollapsed ? 'Expand' : 'Collapse';
    });

    function renderHistory(messages) {
      if (!messages || messages.length === 0) {
        historySection.classList.add('hidden');
        return;
      }

      historySection.classList.remove('hidden');
      historyMessages.innerHTML = messages.map(msg => {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const labelMap = {
          user: 'You',
          assistant: 'Assistant',
          sql: 'SQL',
          result: 'Result',
          error: 'Error'
        };
        return \`
          <div class="history-message \${msg.type}">
            <div class="history-message-label">
              \${labelMap[msg.type] || msg.type}
              <span class="history-message-time">\${time}</span>
            </div>
            \${escapeHtml(msg.content)}
          </div>
        \`;
      }).join('');

      // Scroll to bottom of history
      historySection.scrollTop = historySection.scrollHeight;
    }

    function runQuery() {
      const query = queryInput.value.trim();
      if (!query) return;

      setLoading(true);
      hideError();
      hideClarification();
      hideVerification();
      hideValidationError();
      sqlSection.classList.add('hidden');

      vscode.postMessage({ type: 'query', payload: query });
    }

    function runEditedSql() {
      const sql = sqlEditor.value.trim();
      if (!sql) return;

      setSqlLoading(true, 'Validating...');
      hideValidationError();
      hideError();

      vscode.postMessage({ type: 'runEditedSql', payload: sql });
    }

    function hideClarification() {
      clarificationSection.classList.add('hidden');
      clarificationInput.value = '';
    }

    function hideVerification() {
      verificationSection.classList.add('hidden');
    }

    function hideValidationError() {
      validationError.classList.add('hidden');
      currentValidationError = null;
    }

    function showValidationError(errorMsg) {
      currentValidationError = errorMsg;
      validationErrorMessage.textContent = errorMsg;
      validationError.classList.remove('hidden');
      setSqlLoading(false);
    }

    function showClarification(question) {
      clarificationQuestion.textContent = question;
      clarificationSection.classList.remove('hidden');
      clarificationInput.focus();
      setLoading(false);
    }

    function showVerification(verification) {
      verificationSection.classList.remove('hidden');

      // Set icon and status
      if (verification.correctedSql) {
        verificationSection.className = 'verification-section corrected';
        verificationIcon.textContent = '⚠️';
        verificationStatus.textContent = 'SQL was corrected';
      } else if (verification.isValid) {
        verificationSection.className = 'verification-section valid';
        verificationIcon.textContent = '✓';
        verificationStatus.textContent = 'SQL verified';
      }

      // Set confidence badge
      confidenceBadge.textContent = verification.confidence;
      confidenceBadge.className = 'confidence-badge confidence-' + verification.confidence;

      // Show issues if any
      if (verification.issues && verification.issues.length > 0) {
        verificationIssues.innerHTML = verification.issues.map(issue =>
          '<li>' + escapeHtml(issue) + '</li>'
        ).join('');
        verificationIssues.classList.remove('hidden');
      } else {
        verificationIssues.classList.add('hidden');
      }
    }

    function setLoading(isLoading, text = 'Processing...') {
      loading.classList.toggle('hidden', !isLoading);
      loadingText.textContent = text;
      runButton.disabled = isLoading;
    }

    function setSqlLoading(isLoading, text = 'Processing...') {
      sqlLoading.classList.toggle('hidden', !isLoading);
      sqlLoadingText.textContent = text;
      runSqlButton.disabled = isLoading;
    }

    function showError(message) {
      error.textContent = message;
      error.classList.remove('hidden');
    }

    function hideError() {
      error.classList.add('hidden');
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
            setSqlLoading(true, 'Executing query...');
          } else if (message.payload.startsWith('Regenerating')) {
            setLoading(true, 'Regenerating SQL...');
          } else if (message.payload.startsWith('Validating')) {
            setSqlLoading(true, 'Validating SQL...');
          } else if (message.payload.startsWith('Fixing')) {
            setSqlLoading(true, 'Fixing query...');
          } else if (message.payload.includes('results shown')) {
            setLoading(false);
            setSqlLoading(false);
          }
          break;

        case 'sql':
          sqlEditor.value = message.payload;
          sqlSection.classList.remove('hidden');
          sqlVisible = true;
          sqlEditor.classList.remove('hidden');
          sqlActions.classList.remove('hidden');
          sqlArrow.textContent = '▼';
          setLoading(true, 'Verifying SQL...');
          break;

        case 'verification':
          showVerification(message.payload);
          setLoading(false);
          setSqlLoading(false);
          break;

        case 'clarification':
          const clarificationData = message.payload;
          showClarification(clarificationData.question);
          break;

        case 'validationError':
          const errorData = message.payload;
          showValidationError(errorData.error);
          break;

        case 'validationSuccess':
          hideValidationError();
          setSqlLoading(true, 'Executing query...');
          break;

        case 'error':
          setLoading(false);
          setSqlLoading(false);
          showError(message.payload);
          break;

        case 'history':
          renderHistory(message.payload);
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
