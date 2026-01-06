import * as vscode from 'vscode';
import { SecretStorageService } from './services/secretStorage';
import { DatabaseService } from './services/database';
import { LlmService } from './services/llm';
import { SchemaService } from './services/schema';
import { ConnectionStorageService } from './services/connectionStorage';
import { QueryPanel } from './panels/QueryPanel';
import { ResultsPanel } from './panels/ResultsPanel';
import { ConnectionsProvider, ConnectionItem } from './views/ConnectionsProvider';
import { DbCredentials, LlmConfig, QueryResult, ChatMessage } from './types';

let secretStorageService: SecretStorageService;
let databaseService: DatabaseService;
let llmService: LlmService;
let schemaService: SchemaService;
let connectionStorageService: ConnectionStorageService;
let connectionsProvider: ConnectionsProvider;
let statusBarItem: vscode.StatusBarItem;
let activeConnectionId: string | null = null;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  secretStorageService = new SecretStorageService(context.secrets);
  databaseService = new DatabaseService();
  llmService = new LlmService();
  schemaService = new SchemaService(databaseService);
  connectionStorageService = new ConnectionStorageService(context.globalState, context.secrets);

  // Initialize connections tree view
  connectionsProvider = new ConnectionsProvider(connectionStorageService);
  const treeView = vscode.window.createTreeView('postgresConnections', {
    treeDataProvider: connectionsProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'postgres-agent.query';
  updateStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Load stored LLM config if available
  const storedLlmConfig = await secretStorageService.getLlmConfig();
  if (storedLlmConfig) {
    llmService.setConfig(storedLlmConfig);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('postgres-agent.configure', configureLlm),
    vscode.commands.registerCommand('postgres-agent.connect', connectToDatabase),
    vscode.commands.registerCommand('postgres-agent.query', openQueryPanel),
    vscode.commands.registerCommand('postgres-agent.disconnect', disconnectFromDatabase),
    vscode.commands.registerCommand('postgres-agent.saveConnection', saveCurrentConnection),
    vscode.commands.registerCommand('postgres-agent.connectSaved', connectToSavedConnection),
    vscode.commands.registerCommand('postgres-agent.deleteConnection', deleteConnection),
    vscode.commands.registerCommand('postgres-agent.renameConnection', renameConnection),
    vscode.commands.registerCommand('postgres-agent.clearHistory', clearConnectionHistory),
    vscode.commands.registerCommand('postgres-agent.refreshConnections', () => connectionsProvider.refresh())
  );

  // Store extension URI for webview
  const extensionUri = context.extensionUri;

  async function configureLlm() {
    const currentConfig = await secretStorageService.getLlmConfig();

    const baseUrl = await vscode.window.showInputBox({
      prompt: 'Enter the LLM API base URL (OpenAI-compatible)',
      placeHolder: 'https://api.openai.com or http://localhost:11434',
      value: currentConfig?.baseUrl || '',
      ignoreFocusOut: true,
    });

    if (baseUrl === undefined) {
      return;
    }

    const apiKey = await vscode.window.showInputBox({
      prompt: 'Enter your API key',
      placeHolder: 'sk-...',
      password: true,
      ignoreFocusOut: true,
    });

    if (apiKey === undefined) {
      return;
    }

    const model = await vscode.window.showInputBox({
      prompt: 'Enter the model name',
      placeHolder: 'gpt-4, claude-3-opus, llama2, etc.',
      value: currentConfig?.model || 'gpt-4',
      ignoreFocusOut: true,
    });

    if (model === undefined) {
      return;
    }

    const config: LlmConfig = {
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
    };

    await secretStorageService.saveLlmConfig(config);
    llmService.setConfig(config);

    // Test connection
    const testResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Testing LLM connection...',
      },
      async () => {
        return await llmService.testConnection();
      }
    );

    if (testResult) {
      vscode.window.showInformationMessage('LLM configured successfully!');
    } else {
      vscode.window.showWarningMessage(
        'LLM configuration saved, but connection test failed. Please verify your settings.'
      );
    }
  }

  async function connectToDatabase() {
    const currentCreds = await secretStorageService.getDbCredentials();

    const host = await vscode.window.showInputBox({
      prompt: 'Enter PostgreSQL host',
      placeHolder: 'localhost',
      value: currentCreds?.host || 'localhost',
      ignoreFocusOut: true,
    });

    if (host === undefined) {
      return;
    }

    const portStr = await vscode.window.showInputBox({
      prompt: 'Enter PostgreSQL port',
      placeHolder: '5432',
      value: currentCreds?.port?.toString() || '5432',
      ignoreFocusOut: true,
    });

    if (portStr === undefined) {
      return;
    }

    const port = parseInt(portStr, 10);
    if (isNaN(port)) {
      vscode.window.showErrorMessage('Invalid port number');
      return;
    }

    const user = await vscode.window.showInputBox({
      prompt: 'Enter PostgreSQL username',
      placeHolder: 'postgres',
      value: currentCreds?.user || '',
      ignoreFocusOut: true,
    });

    if (user === undefined) {
      return;
    }

    const password = await vscode.window.showInputBox({
      prompt: 'Enter PostgreSQL password',
      password: true,
      ignoreFocusOut: true,
    });

    if (password === undefined) {
      return;
    }

    const database = await vscode.window.showInputBox({
      prompt: 'Enter database name',
      placeHolder: 'postgres',
      value: currentCreds?.database || '',
      ignoreFocusOut: true,
    });

    if (database === undefined) {
      return;
    }

    const sslChoice = await vscode.window.showQuickPick(['No', 'Yes'], {
      placeHolder: 'Use SSL connection?',
    });

    const ssl = sslChoice === 'Yes';

    const credentials: DbCredentials = {
      host: host.trim(),
      port,
      user: user.trim(),
      password,
      database: database.trim(),
      ssl,
    };

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Connecting to PostgreSQL...',
        },
        async () => {
          await databaseService.connect(credentials);
          await secretStorageService.saveDbCredentials(credentials);
          await schemaService.refresh();
        }
      );

      updateStatusBar();
      activeConnectionId = null;
      connectionsProvider.setActiveConnection(null);

      const tableCount = schemaService.getSchema()?.tables.length || 0;
      const saveAction = await vscode.window.showInformationMessage(
        `Connected to ${database}@${host}. ${tableCount} tables found.`,
        'Save Connection',
        'Dismiss'
      );

      if (saveAction === 'Save Connection') {
        await saveCurrentConnection(credentials);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to connect: ${message}`);
    }
  }

  async function saveCurrentConnection(credentials?: DbCredentials) {
    const creds = credentials || await secretStorageService.getDbCredentials();
    if (!creds) {
      vscode.window.showErrorMessage('No active connection to save.');
      return;
    }

    const defaultName = `${creds.database}@${creds.host}`;
    const name = await vscode.window.showInputBox({
      prompt: 'Enter a name for this connection',
      placeHolder: defaultName,
      value: defaultName,
      ignoreFocusOut: true,
      validateInput: async (value) => {
        if (!value.trim()) {
          return 'Connection name cannot be empty';
        }
        if (await connectionStorageService.connectionExists(value.trim())) {
          return 'A connection with this name already exists';
        }
        return null;
      }
    });

    if (!name) {
      return;
    }

    const savedConnection = await connectionStorageService.saveConnection(name.trim(), creds);
    activeConnectionId = savedConnection.id;
    connectionsProvider.setActiveConnection(savedConnection.id);
    vscode.window.showInformationMessage(`Connection "${name}" saved.`);
  }

  async function connectToSavedConnection(item: ConnectionItem) {
    const connection = item.connection;
    const credentials = await connectionStorageService.getCredentials(connection.id);

    if (!credentials) {
      vscode.window.showErrorMessage('Could not retrieve connection credentials.');
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Connecting to ${connection.name}...`,
        },
        async () => {
          if (databaseService.isConnected()) {
            await databaseService.disconnect();
          }
          await databaseService.connect(credentials);
          await schemaService.refresh();
          await connectionStorageService.updateLastUsed(connection.id);
        }
      );

      activeConnectionId = connection.id;
      connectionsProvider.setActiveConnection(connection.id);
      updateStatusBar();

      // Load chat history and open query panel
      const history = connectionStorageService.getChatHistory(connection.id);
      openQueryPanelWithHistory(history.messages);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to connect: ${message}`);
    }
  }

  async function deleteConnection(item: ConnectionItem) {
    const connection = item.connection;
    const confirm = await vscode.window.showWarningMessage(
      `Delete connection "${connection.name}"? This will also delete the chat history.`,
      { modal: true },
      'Delete'
    );

    if (confirm !== 'Delete') {
      return;
    }

    await connectionStorageService.deleteConnection(connection.id);

    if (activeConnectionId === connection.id) {
      activeConnectionId = null;
      connectionsProvider.setActiveConnection(null);
    }

    connectionsProvider.refresh();
    vscode.window.showInformationMessage(`Connection "${connection.name}" deleted.`);
  }

  async function renameConnection(item: ConnectionItem) {
    const connection = item.connection;
    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new name for the connection',
      value: connection.name,
      ignoreFocusOut: true,
      validateInput: async (value) => {
        if (!value.trim()) {
          return 'Connection name cannot be empty';
        }
        if (value.trim() !== connection.name && await connectionStorageService.connectionExists(value.trim())) {
          return 'A connection with this name already exists';
        }
        return null;
      }
    });

    if (!newName || newName === connection.name) {
      return;
    }

    await connectionStorageService.renameConnection(connection.id, newName.trim());
    connectionsProvider.refresh();
    vscode.window.showInformationMessage(`Connection renamed to "${newName}".`);
  }

  async function clearConnectionHistory(item: ConnectionItem) {
    const connection = item.connection;
    const confirm = await vscode.window.showWarningMessage(
      `Clear chat history for "${connection.name}"?`,
      { modal: true },
      'Clear'
    );

    if (confirm !== 'Clear') {
      return;
    }

    await connectionStorageService.clearChatHistory(connection.id);
    vscode.window.showInformationMessage(`Chat history for "${connection.name}" cleared.`);
  }

  async function openQueryPanel() {
    await openQueryPanelWithHistory([]);
  }

  async function openQueryPanelWithHistory(history: ChatMessage[]) {
    if (!databaseService.isConnected()) {
      const action = await vscode.window.showWarningMessage(
        'Not connected to a database. Would you like to connect now?',
        'Connect',
        'Cancel'
      );
      if (action === 'Connect') {
        await connectToDatabase();
        if (!databaseService.isConnected()) {
          return;
        }
      } else {
        return;
      }
    }

    if (!llmService.isConfigured()) {
      const action = await vscode.window.showWarningMessage(
        'LLM not configured. Would you like to configure it now?',
        'Configure',
        'Cancel'
      );
      if (action === 'Configure') {
        await configureLlm();
        if (!llmService.isConfigured()) {
          return;
        }
      } else {
        return;
      }
    }

    // Helper to save messages to history
    const saveMessage = async (type: ChatMessage['type'], content: string, sql?: string, rowCount?: number) => {
      if (activeConnectionId) {
        await connectionStorageService.saveChatMessage(activeConnectionId, {
          type,
          content,
          sql,
          rowCount,
        });
      }
    };

    const panel = QueryPanel.createOrShow(
      extensionUri,
      // Main query handler
      async (query: string) => {
        // Save user query
        await saveMessage('user', query);

        const schemaContext = schemaService.getSchemaContext();
        const sql = await llmService.generateSql(schemaContext, query);

        // Verify the generated SQL
        const verification = await llmService.verifySql(schemaContext, query, sql);

        // If clarification is needed, return early with the clarification request
        if (verification.needsClarification && verification.clarificationQuestion) {
          await saveMessage('assistant', verification.clarificationQuestion);
          return {
            sql,
            verification,
            needsClarification: true,
            clarificationQuestion: verification.clarificationQuestion
          };
        }

        // Use corrected SQL if provided, otherwise use original
        const finalSql = verification.correctedSql || sql;

        // Save SQL
        await saveMessage('sql', finalSql);

        const result = await databaseService.executeQuery(finalSql);

        // Save result summary
        await saveMessage('result', `Query returned ${result.rowCount} rows`, finalSql, result.rowCount);

        return { sql: finalSql, result, verification };
      },
      // Clarification handler
      async (originalQuestion: string, clarificationAnswer: string) => {
        // Save clarification response
        await saveMessage('user', clarificationAnswer);

        const schemaContext = schemaService.getSchemaContext();
        const sql = await llmService.regenerateSqlWithClarification(
          schemaContext,
          originalQuestion,
          clarificationAnswer
        );

        // Verify the regenerated SQL (should be valid now with clarification)
        const verification = await llmService.verifySql(schemaContext, originalQuestion, sql);
        const finalSql = verification.correctedSql || sql;

        // Save SQL
        await saveMessage('sql', finalSql);

        const result = await databaseService.executeQuery(finalSql);

        // Save result summary
        await saveMessage('result', `Query returned ${result.rowCount} rows`, finalSql, result.rowCount);

        return { sql: finalSql, result, verification };
      },
      // Validate SQL handler
      async (sql: string) => {
        return await databaseService.validateSql(sql);
      },
      // Run edited SQL handler
      async (sql: string) => {
        // Save edited SQL
        await saveMessage('sql', sql);

        const result = await databaseService.executeQuery(sql);

        // Save result summary
        await saveMessage('result', `Query returned ${result.rowCount} rows`, sql, result.rowCount);

        return { sql, result };
      },
      // Fix query handler
      async (sql: string, error: string, originalQuestion: string) => {
        const schemaContext = schemaService.getSchemaContext();
        const fixedSql = await llmService.fixSql(schemaContext, sql, error, originalQuestion);

        // Save fixed SQL
        await saveMessage('sql', fixedSql);

        const result = await databaseService.executeQuery(fixedSql);

        // Save result summary
        await saveMessage('result', `Query returned ${result.rowCount} rows`, fixedSql, result.rowCount);

        return { sql: fixedSql, result };
      },
      // Show results handler
      (sql: string, result: QueryResult) => {
        ResultsPanel.show(sql, result);
      },
      // Initial history
      history
    );

    panel.updateConnectionStatus(true, databaseService.getConnectionInfo());
  }

  async function disconnectFromDatabase() {
    if (!databaseService.isConnected()) {
      vscode.window.showInformationMessage('Not connected to any database.');
      return;
    }

    await databaseService.disconnect();
    schemaService.clear();
    activeConnectionId = null;
    connectionsProvider.setActiveConnection(null);
    updateStatusBar();
    vscode.window.showInformationMessage('Disconnected from database.');
  }

  function updateStatusBar() {
    if (databaseService.isConnected()) {
      statusBarItem.text = '$(database) PG: Connected';
      statusBarItem.tooltip = databaseService.getConnectionInfo();
    } else {
      statusBarItem.text = '$(database) PG: Disconnected';
      statusBarItem.tooltip = 'Click to open query panel';
    }
  }
}

export function deactivate() {
  if (databaseService) {
    databaseService.disconnect();
  }
}
