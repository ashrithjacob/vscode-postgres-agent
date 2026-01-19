import * as vscode from 'vscode';
import { WebviewMessage, QueryResult, SqlVerificationResult, SqlValidationResult, ChatMessage } from '../types';

interface QueryResponse {
  sql: string;
  result?: QueryResult;
  verification?: SqlVerificationResult;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  executionError?: string;
  validationError?: string;
  isValidQuery?: boolean;
  generationFailed?: boolean;
  lastError?: string;
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
  result?: QueryResult;
  validationError?: string;
  isValidQuery?: boolean;
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
    private readonly onTruncateHistory: (fromIndex: number) => Promise<void>,
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
        } else if (message.type === 'truncateHistory' && typeof message.payload === 'object' && message.payload !== null) {
          const payload = message.payload as { fromIndex: number };
          if (this.onTruncateHistory) {
            await this.onTruncateHistory(payload.fromIndex);
          }
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
    onTruncateHistory: (fromIndex: number) => Promise<void>,
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

    QueryPanel.currentPanel = new QueryPanel(panel, extensionUri, onQuery, onClarification, onValidateSql, onRunEditedSql, onFixQuery, onShowResults, onTruncateHistory, initialHistory);
    return QueryPanel.currentPanel;
  }

  private async handleQuery(query: string): Promise<void> {
    this.sendMessage({ type: 'status', payload: 'Generating SQL...' });

    try {
      const response = await this.onQuery(query);

      // Check if clarification is needed
      if (response.needsClarification && response.clarificationQuestion) {
        this.pendingClarificationQuery = query;
        this.sendMessage({
          type: 'clarification',
          payload: {
            question: response.clarificationQuestion,
            originalSql: response.sql
          }
        });
        return;
      }

      // Check if generation failed after all retries
      if (response.generationFailed) {
        this.sendMessage({
          type: 'generationFailed',
          payload: {
            error: response.lastError || 'Failed to generate valid SQL after multiple attempts',
            originalQuery: query
          }
        });
        return;
      }

      // SQL is valid - show verification info if available
      if (response.verification) {
        this.sendMessage({ type: 'verification', payload: response.verification });
      }

      // Show the validated SQL with Run Query button
      this.sendMessage({ type: 'sqlValidated', payload: response.sql });

      // If we already have results (query was auto-executed), show them
      if (response.result) {
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

      // Check if the fixed SQL is still invalid
      if (response.validationError && !response.isValidQuery) {
        // Show the fixed SQL but still invalid - show Fix Query option again
        this.sendMessage({ type: 'sqlPendingValidation', payload: response.sql });
        this.sendMessage({
          type: 'validationError',
          payload: {
            error: response.validationError,
            sql: response.sql
          }
        });
        return;
      }

      // SQL is now valid - show with Run Query button
      this.sendMessage({ type: 'sqlValidated', payload: response.sql });
      this.sendMessage({ type: 'status', payload: 'Query fixed - click Run SQL to execute' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
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
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      margin: 0;
      padding: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      padding: 12px 16px;
      background-color: var(--vscode-statusBar-background);
      color: var(--vscode-statusBar-foreground);
      font-size: 0.9em;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    .header h1 {
      font-size: 1.2em;
      margin: 0 0 4px 0;
    }

    .chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chat-message {
      max-width: 85%;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.4;
    }

    .chat-message.user {
      align-self: flex-end;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-bottom-right-radius: 4px;
    }

    .chat-message.assistant {
      align-self: flex-start;
      background-color: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-panel-border);
      border-bottom-left-radius: 4px;
    }

    .chat-message.sql-message {
      align-self: flex-start;
      background-color: transparent;
      border: none;
      border-bottom-left-radius: 4px;
      max-width: 98%;
      width: 98%;
      padding: 8px 0;
    }

    .chat-message.result {
      align-self: flex-start;
      background-color: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
      border-bottom-left-radius: 4px;
    }

    .chat-message.error-msg {
      align-self: flex-start;
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
      border-bottom-left-radius: 4px;
    }

    .generation-failed-content p {
      margin: 0 0 8px 0;
    }

    .generation-failed-content .error-detail {
      font-size: 0.9em;
      opacity: 0.9;
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .chat-message .label {
      font-size: 0.75em;
      opacity: 0.7;
      margin-bottom: 6px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .sql-container {
      position: relative;
      width: 100%;
    }

    .sql-copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: var(--vscode-button-secondaryBackground);
      border: none;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0.7;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--vscode-button-secondaryForeground);
    }

    .sql-copy-btn:hover {
      opacity: 1;
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .sql-copy-btn.copied {
      background: var(--vscode-testing-iconPassed);
      color: var(--vscode-editor-background);
    }

    .sql-content {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      padding: 12px;
      padding-right: 60px;
      background-color: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      min-height: 100px;
    }

    .sql-editor-inline {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px;
      width: 100%;
      min-height: 120px;
      padding: 12px;
      padding-right: 60px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      resize: vertical;
    }

    .sql-editor-inline:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }

    .sql-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .btn-resume {
      background-color: var(--vscode-editorWarning-foreground);
      color: var(--vscode-editor-background);
    }

    .btn-resume:hover {
      opacity: 0.9;
    }

    .validation-error-inline {
      margin-top: 10px;
      padding: 10px;
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 4px;
    }

    .validation-error-inline .error-header {
      font-weight: 600;
      color: var(--vscode-errorForeground);
      margin-bottom: 6px;
      font-size: 0.85em;
    }

    .validation-error-inline .error-text {
      font-size: 0.85em;
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
    }

    .verification-inline {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 0.85em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .verification-inline.valid {
      background-color: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
    }

    .verification-inline.corrected {
      background-color: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
    }

    .confidence-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.75em;
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

    .clarification-inline {
      margin-top: 10px;
      padding: 12px;
      background-color: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 4px;
    }

    .clarification-inline .question {
      font-weight: 600;
      margin-bottom: 10px;
    }

    .clarification-inline input {
      width: 100%;
      padding: 8px 10px;
      font-size: 13px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      margin-bottom: 10px;
    }

    .clarification-inline input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }

    .clarification-inline .buttons {
      display: flex;
      gap: 8px;
    }

    .input-section {
      padding: 16px;
      background-color: var(--vscode-editor-background);
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    .input-wrapper {
      display: flex;
      gap: 10px;
      align-items: flex-end;
    }

    .query-input {
      flex: 1;
      min-height: 60px;
      max-height: 150px;
      padding: 10px 12px;
      font-size: 14px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 8px;
      resize: none;
      font-family: inherit;
    }

    .query-input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }

    .query-input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    button {
      padding: 8px 16px;
      font-size: 13px;
      cursor: pointer;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      font-family: inherit;
      white-space: nowrap;
    }

    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.btn-secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    button.btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .send-button {
      height: 40px;
      min-width: 80px;
    }

    .loading-inline {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
    }

    .spinner {
      width: 14px;
      height: 14px;
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

    .typing-indicator {
      align-self: flex-start;
      padding: 12px 16px;
      background-color: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      border-bottom-left-radius: 4px;
    }

    .typing-dots {
      display: flex;
      gap: 4px;
    }

    .typing-dots span {
      width: 8px;
      height: 8px;
      background-color: var(--vscode-descriptionForeground);
      border-radius: 50%;
      animation: typing 1.4s infinite ease-in-out;
    }

    .typing-dots span:nth-child(1) { animation-delay: 0s; }
    .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes typing {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 40px;
    }

    .empty-state h2 {
      margin: 0 0 12px 0;
      color: var(--vscode-foreground);
      font-size: 1.2em;
    }

    .empty-state p {
      margin: 0 0 8px 0;
      font-size: 0.9em;
    }

    .empty-state .examples {
      margin-top: 16px;
      text-align: left;
    }

    .empty-state .examples li {
      margin-bottom: 6px;
      font-size: 0.85em;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>PostgreSQL Agent</h1>
    <div id="status">Initializing...</div>
  </div>

  <div class="chat-container" id="chatContainer">
    <div class="empty-state" id="emptyState">
      <h2>Ask a question about your database</h2>
      <p>I'll generate SQL queries from natural language.</p>
      <ul class="examples">
        <li>Show me all users who signed up last week</li>
        <li>What are the top 10 products by sales?</li>
        <li>List all orders with their customer names</li>
      </ul>
    </div>
  </div>

  <div class="typing-indicator hidden" id="typingIndicator">
    <div class="typing-dots">
      <span></span>
      <span></span>
      <span></span>
    </div>
  </div>

  <div class="input-section">
    <div class="input-wrapper">
      <textarea
        class="query-input"
        id="queryInput"
        placeholder="Ask a question about your database..."
        rows="2"
      ></textarea>
      <button class="send-button" id="sendButton">Send</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // State
    let currentSqlMessageId = null;
    let currentValidationError = null;
    let messageIdCounter = 0;

    // Elements
    const chatContainer = document.getElementById('chatContainer');
    const emptyState = document.getElementById('emptyState');
    const typingIndicator = document.getElementById('typingIndicator');
    const queryInput = document.getElementById('queryInput');
    const sendButton = document.getElementById('sendButton');
    const status = document.getElementById('status');

    // Event Listeners
    sendButton.addEventListener('click', sendQuery);
    queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendQuery();
      }
    });

    // Auto-resize textarea
    queryInput.addEventListener('input', () => {
      queryInput.style.height = 'auto';
      queryInput.style.height = Math.min(queryInput.scrollHeight, 150) + 'px';
    });

    function generateMessageId() {
      return 'msg-' + (++messageIdCounter);
    }

    function sendQuery() {
      const query = queryInput.value.trim();
      if (!query) return;

      // Hide empty state
      emptyState.classList.add('hidden');

      // Add user message to chat
      addUserMessage(query);

      // Clear input
      queryInput.value = '';
      queryInput.style.height = 'auto';

      // Show typing indicator
      showTyping(true);

      // Disable send button
      sendButton.disabled = true;

      // Send to extension
      vscode.postMessage({ type: 'query', payload: query });
    }

    function addUserMessage(text) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message user';
      msgDiv.textContent = text;
      chatContainer.appendChild(msgDiv);
      scrollToBottom();
    }

    function addSqlMessage(sql, isValid, verification, validationError, isEditable = true) {
      const msgId = generateMessageId();
      currentSqlMessageId = msgId;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message sql-message';
      msgDiv.id = msgId;
      msgDiv.dataset.sql = sql; // Store original SQL

      let verificationHtml = '';
      if (verification) {
        const vClass = verification.correctedSql ? 'corrected' : 'valid';
        const vIcon = verification.correctedSql ? '⚠️' : '✓';
        const vText = verification.correctedSql ? 'SQL was corrected' : 'SQL verified';
        verificationHtml = \`
          <div class="verification-inline \${vClass}">
            <span>\${vIcon} \${vText}</span>
            <span class="confidence-badge confidence-\${verification.confidence}">\${verification.confidence}</span>
          </div>
        \`;
      }

      let errorHtml = '';
      if (validationError) {
        currentValidationError = validationError;
        errorHtml = \`
          <div class="validation-error-inline">
            <div class="error-header">SQL Validation Error</div>
            <div class="error-text">\${escapeHtml(validationError)}</div>
          </div>
        \`;
      }

      // Use textarea for editable, div for read-only - wrapped in container with copy button
      const sqlHtml = isEditable
        ? \`<div class="sql-container">
            <button class="sql-copy-btn" onclick="copySql('\${msgId}')" title="Copy SQL">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h3v1H4v9h9v-3h1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"/><path d="M7 1h6a1 1 0 011 1v6a1 1 0 01-1 1H7a1 1 0 01-1-1V2a1 1 0 011-1zm0 1v6h6V2H7z"/></svg>
              <span id="copy-text-\${msgId}">Copy</span>
            </button>
            <textarea class="sql-editor-inline" id="sql-\${msgId}" spellcheck="false">\${escapeHtml(sql)}</textarea>
          </div>\`
        : \`<div class="sql-container">
            <button class="sql-copy-btn" onclick="copySql('\${msgId}')" title="Copy SQL">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h3v1H4v9h9v-3h1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"/><path d="M7 1h6a1 1 0 011 1v6a1 1 0 01-1 1H7a1 1 0 01-1-1V2a1 1 0 011-1zm0 1v6h6V2H7z"/></svg>
              <span id="copy-text-\${msgId}">Copy</span>
            </button>
            <div class="sql-content" id="sql-\${msgId}">\${escapeHtml(sql)}</div>
          </div>\`;

      const actionsHtml = isValid ? \`
        <div class="sql-actions">
          <button onclick="runSql('\${msgId}')">Run Query</button>
          <button class="btn-secondary btn-resume" onclick="resumeFromHere('\${msgId}')">Resume From Here</button>
          <div class="loading-inline hidden" id="loading-\${msgId}">
            <div class="spinner"></div>
            <span>Executing...</span>
          </div>
        </div>
      \` : \`
        <div class="sql-actions">
          <button onclick="fixSql('\${msgId}')">Fix Query</button>
          <button class="btn-secondary" onclick="dismissError('\${msgId}')">Dismiss</button>
          <button class="btn-secondary btn-resume" onclick="resumeFromHere('\${msgId}')">Resume From Here</button>
          <div class="loading-inline hidden" id="loading-\${msgId}">
            <div class="spinner"></div>
            <span>Fixing...</span>
          </div>
        </div>
      \`;

      msgDiv.innerHTML = \`
        \${sqlHtml}
        \${verificationHtml}
        \${errorHtml}
        \${actionsHtml}
      \`;

      chatContainer.appendChild(msgDiv);
      scrollToBottom();
    }

    function addClarificationMessage(question) {
      const msgId = generateMessageId();

      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message assistant';
      msgDiv.id = msgId;

      msgDiv.innerHTML = \`
        <div class="label">Clarification Needed</div>
        <div class="clarification-inline">
          <div class="question">\${escapeHtml(question)}</div>
          <input type="text" id="clarification-input-\${msgId}" placeholder="Type your answer here...">
          <div class="buttons">
            <button onclick="submitClarification('\${msgId}')">Submit</button>
            <button class="btn-secondary" onclick="skipClarification('\${msgId}')">Skip</button>
          </div>
        </div>
      \`;

      chatContainer.appendChild(msgDiv);
      scrollToBottom();

      // Focus the input
      setTimeout(() => {
        const input = document.getElementById('clarification-input-' + msgId);
        if (input) {
          input.focus();
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              submitClarification(msgId);
            }
          });
        }
      }, 100);
    }

    function addResultMessage(text) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message result';
      msgDiv.innerHTML = \`
        <div class="label">Result</div>
        <div>\${escapeHtml(text)}</div>
      \`;
      chatContainer.appendChild(msgDiv);
      scrollToBottom();
    }

    function addErrorMessage(text) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message error-msg';
      msgDiv.innerHTML = \`
        <div class="label">Error</div>
        <div>\${escapeHtml(text)}</div>
      \`;
      chatContainer.appendChild(msgDiv);
      scrollToBottom();
    }

    function addGenerationFailedMessage(error, originalQuery) {
      const msgId = generateMessageId();
      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message error-msg';
      msgDiv.id = msgId;
      msgDiv.dataset.originalQuery = originalQuery;
      msgDiv.innerHTML = \`
        <div class="label">SQL Generation Failed</div>
        <div class="generation-failed-content">
          <p>Unable to generate a valid SQL query after multiple attempts.</p>
          <p class="error-detail"><strong>Last error:</strong> \${escapeHtml(error)}</p>
          <div class="sql-actions" style="margin-top: 12px;">
            <button onclick="retryQuery('\${msgId}')">Try Again</button>
            <button class="btn-secondary" onclick="dismissFailure('\${msgId}')">Dismiss</button>
          </div>
        </div>
      \`;
      chatContainer.appendChild(msgDiv);
      scrollToBottom();
    }

    window.retryQuery = function(msgId) {
      const msgDiv = document.getElementById(msgId);
      if (!msgDiv) return;

      const originalQuery = msgDiv.dataset.originalQuery;
      if (!originalQuery) return;

      // Remove the failure message
      msgDiv.remove();

      // Show typing indicator
      showTyping(true);
      sendButton.disabled = true;

      // Re-send the query
      vscode.postMessage({ type: 'query', payload: originalQuery });
    };

    window.dismissFailure = function(msgId) {
      const msgDiv = document.getElementById(msgId);
      if (msgDiv) {
        msgDiv.remove();
      }
      sendButton.disabled = false;
    };

    function updateSqlMessage(msgId, sql, isValid, verification, validationError) {
      const msgDiv = document.getElementById(msgId);
      if (!msgDiv) {
        addSqlMessage(sql, isValid, verification, validationError);
        return;
      }

      let verificationHtml = '';
      if (verification) {
        const vClass = verification.correctedSql ? 'corrected' : 'valid';
        const vIcon = verification.correctedSql ? '⚠️' : '✓';
        const vText = verification.correctedSql ? 'SQL was corrected' : 'SQL verified';
        verificationHtml = \`
          <div class="verification-inline \${vClass}">
            <span>\${vIcon} \${vText}</span>
            <span class="confidence-badge confidence-\${verification.confidence}">\${verification.confidence}</span>
          </div>
        \`;
      }

      let errorHtml = '';
      if (validationError) {
        currentValidationError = validationError;
        errorHtml = \`
          <div class="validation-error-inline">
            <div class="error-header">SQL Validation Error</div>
            <div class="error-text">\${escapeHtml(validationError)}</div>
          </div>
        \`;
      } else {
        currentValidationError = null;
      }

      const sqlHtml = \`<div class="sql-container">
        <button class="sql-copy-btn" onclick="copySql('\${msgId}')" title="Copy SQL">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h3v1H4v9h9v-3h1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"/><path d="M7 1h6a1 1 0 011 1v6a1 1 0 01-1 1H7a1 1 0 01-1-1V2a1 1 0 011-1zm0 1v6h6V2H7z"/></svg>
          <span id="copy-text-\${msgId}">Copy</span>
        </button>
        <textarea class="sql-editor-inline" id="sql-\${msgId}" spellcheck="false">\${escapeHtml(sql)}</textarea>
      </div>\`;

      const actionsHtml = isValid ? \`
        <div class="sql-actions">
          <button onclick="runSql('\${msgId}')">Run Query</button>
          <button class="btn-secondary btn-resume" onclick="resumeFromHere('\${msgId}')">Resume From Here</button>
          <div class="loading-inline hidden" id="loading-\${msgId}">
            <div class="spinner"></div>
            <span>Executing...</span>
          </div>
        </div>
      \` : \`
        <div class="sql-actions">
          <button onclick="fixSql('\${msgId}')">Fix Query</button>
          <button class="btn-secondary" onclick="dismissError('\${msgId}')">Dismiss</button>
          <button class="btn-secondary btn-resume" onclick="resumeFromHere('\${msgId}')">Resume From Here</button>
          <div class="loading-inline hidden" id="loading-\${msgId}">
            <div class="spinner"></div>
            <span>Fixing...</span>
          </div>
        </div>
      \`;

      msgDiv.innerHTML = \`
        \${sqlHtml}
        \${verificationHtml}
        \${errorHtml}
        \${actionsHtml}
      \`;
    }

    function showTyping(show) {
      if (show) {
        chatContainer.appendChild(typingIndicator);
        typingIndicator.classList.remove('hidden');
      } else {
        typingIndicator.classList.add('hidden');
      }
      scrollToBottom();
    }

    function scrollToBottom() {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Helper to get SQL content from either textarea or div
    function getSqlContent(msgId) {
      const sqlElement = document.getElementById('sql-' + msgId);
      if (!sqlElement) return null;
      // Check if it's a textarea or div
      return sqlElement.tagName === 'TEXTAREA' ? sqlElement.value : sqlElement.textContent;
    }

    // Global functions for button handlers
    window.runSql = function(msgId) {
      const sql = getSqlContent(msgId);
      if (!sql) return;

      const loading = document.getElementById('loading-' + msgId);
      if (loading) loading.classList.remove('hidden');

      vscode.postMessage({ type: 'runEditedSql', payload: sql });
    };

    window.fixSql = function(msgId) {
      const sql = getSqlContent(msgId);
      if (!sql || !currentValidationError) return;

      const loading = document.getElementById('loading-' + msgId);
      if (loading) {
        loading.classList.remove('hidden');
        loading.querySelector('span').textContent = 'Fixing...';
      }

      vscode.postMessage({
        type: 'fixQuery',
        payload: { sql, error: currentValidationError }
      });
    };

    window.dismissError = function(msgId) {
      const msgDiv = document.getElementById(msgId);
      if (msgDiv) {
        const errorDiv = msgDiv.querySelector('.validation-error-inline');
        if (errorDiv) errorDiv.remove();
      }
      currentValidationError = null;
    };

    window.copySql = function(msgId) {
      const sql = getSqlContent(msgId);
      if (!sql) return;

      navigator.clipboard.writeText(sql).then(() => {
        const copyText = document.getElementById('copy-text-' + msgId);
        const copyBtn = copyText?.parentElement;
        if (copyText && copyBtn) {
          copyText.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyText.textContent = 'Copy';
            copyBtn.classList.remove('copied');
          }, 2000);
        }
      });
    };

    window.resumeFromHere = function(msgId) {
      const msgDiv = document.getElementById(msgId);
      if (!msgDiv) return;

      // Get the SQL content (edited or original)
      const sql = getSqlContent(msgId);
      if (!sql) return;

      // Find the index of this message's parent user message
      const allMessages = Array.from(chatContainer.querySelectorAll('.chat-message'));
      const msgIndex = allMessages.indexOf(msgDiv);

      // Find the user message that precedes this SQL message
      let userMsgIndex = -1;
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (allMessages[i].classList.contains('user')) {
          userMsgIndex = i;
          break;
        }
      }

      // Remove all messages after the user message (including this SQL message)
      if (userMsgIndex >= 0) {
        const messagesToRemove = allMessages.slice(userMsgIndex + 1);
        messagesToRemove.forEach(msg => msg.remove());
      }

      // Put the user's original question back in the input for editing
      if (userMsgIndex >= 0) {
        const userMsg = allMessages[userMsgIndex];
        const userQuestion = userMsg.textContent;
        // Remove the user message too so they can re-submit
        userMsg.remove();
        queryInput.value = userQuestion;
        queryInput.focus();
        queryInput.style.height = 'auto';
        queryInput.style.height = Math.min(queryInput.scrollHeight, 150) + 'px';
      }

      // Notify extension to truncate history
      vscode.postMessage({ type: 'truncateHistory', payload: { fromIndex: userMsgIndex } });

      // Show empty state if no messages left
      const remainingMessages = chatContainer.querySelectorAll('.chat-message');
      if (remainingMessages.length === 0) {
        emptyState.classList.remove('hidden');
      }
    };

    window.submitClarification = function(msgId) {
      const input = document.getElementById('clarification-input-' + msgId);
      if (!input) return;

      const answer = input.value.trim();
      if (!answer) return;

      // Add user's answer as a message
      addUserMessage(answer);

      // Remove the clarification UI
      const msgDiv = document.getElementById(msgId);
      if (msgDiv) msgDiv.remove();

      // Show typing
      showTyping(true);
      sendButton.disabled = true;

      vscode.postMessage({ type: 'clarificationResponse', payload: answer });
    };

    window.skipClarification = function(msgId) {
      const msgDiv = document.getElementById(msgId);
      if (msgDiv) msgDiv.remove();
      sendButton.disabled = false;
    };

    // Render history from saved messages
    function renderHistory(messages) {
      if (!messages || messages.length === 0) return;

      emptyState.classList.add('hidden');

      // Find the last SQL message index
      let lastSqlIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].type === 'sql') {
          lastSqlIndex = i;
          break;
        }
      }

      messages.forEach((msg, index) => {
        if (msg.type === 'user') {
          addUserMessage(msg.content);
        } else if (msg.type === 'sql') {
          // Only the last SQL message is editable
          const isEditable = (index === lastSqlIndex);
          addSqlMessage(msg.content, true, null, null, isEditable);
        } else if (msg.type === 'result') {
          addResultMessage(msg.content);
        } else if (msg.type === 'error') {
          addErrorMessage(msg.content);
        } else if (msg.type === 'assistant') {
          // Clarification question - just show as assistant message
          const msgDiv = document.createElement('div');
          msgDiv.className = 'chat-message assistant';
          msgDiv.innerHTML = '<div class="label">Assistant</div><div>' + escapeHtml(msg.content) + '</div>';
          chatContainer.appendChild(msgDiv);
        }
      });

      scrollToBottom();
    }

    // Message handler
    window.addEventListener('message', (event) => {
      const message = event.data;

      switch (message.type) {
        case 'status':
          status.textContent = message.payload;
          if (message.payload.includes('results shown')) {
            sendButton.disabled = false;
            // Hide any loading indicators
            document.querySelectorAll('.loading-inline').forEach(el => el.classList.add('hidden'));
          }
          break;

        case 'sqlPendingValidation':
          showTyping(false);
          addSqlMessage(message.payload, false, null, null);
          sendButton.disabled = false;
          break;

        case 'sqlValidated':
          showTyping(false);
          addSqlMessage(message.payload, true, null, null);
          sendButton.disabled = false;
          break;

        case 'verification':
          // Update the current SQL message with verification info
          if (currentSqlMessageId) {
            const msgDiv = document.getElementById(currentSqlMessageId);
            if (msgDiv) {
              const verification = message.payload;
              const vClass = verification.correctedSql ? 'corrected' : 'valid';
              const vIcon = verification.correctedSql ? '⚠️' : '✓';
              const vText = verification.correctedSql ? 'SQL was corrected' : 'SQL verified';

              // Check if verification already exists
              let verificationDiv = msgDiv.querySelector('.verification-inline');
              if (!verificationDiv) {
                verificationDiv = document.createElement('div');
                const sqlContent = msgDiv.querySelector('.sql-content');
                if (sqlContent) {
                  sqlContent.insertAdjacentElement('afterend', verificationDiv);
                }
              }
              verificationDiv.className = 'verification-inline ' + vClass;
              verificationDiv.innerHTML = \`
                <span>\${vIcon} \${vText}</span>
                <span class="confidence-badge confidence-\${verification.confidence}">\${verification.confidence}</span>
              \`;
            }
          }
          break;

        case 'clarification':
          showTyping(false);
          addClarificationMessage(message.payload.question);
          sendButton.disabled = false;
          break;

        case 'validationError':
          showTyping(false);
          if (currentSqlMessageId) {
            updateSqlMessage(currentSqlMessageId,
              document.getElementById('sql-' + currentSqlMessageId)?.textContent || '',
              false, null, message.payload.error);
          }
          sendButton.disabled = false;
          // Hide loading indicators
          document.querySelectorAll('.loading-inline').forEach(el => el.classList.add('hidden'));
          break;

        case 'validationSuccess':
          // Hide loading and let status handle the rest
          break;

        case 'error':
          showTyping(false);
          addErrorMessage(message.payload);
          sendButton.disabled = false;
          // Hide loading indicators
          document.querySelectorAll('.loading-inline').forEach(el => el.classList.add('hidden'));
          break;

        case 'generationFailed':
          showTyping(false);
          addGenerationFailedMessage(message.payload.error, message.payload.originalQuery);
          sendButton.disabled = false;
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
