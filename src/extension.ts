import * as vscode from 'vscode';
import { SecretStorageService } from './services/secretStorage';
import { DatabaseService } from './services/database';
import { LlmService } from './services/llm';
import { SchemaService } from './services/schema';
import { QueryPanel } from './panels/QueryPanel';
import { DbCredentials, LlmConfig } from './types';

let secretStorageService: SecretStorageService;
let databaseService: DatabaseService;
let llmService: LlmService;
let schemaService: SchemaService;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  secretStorageService = new SecretStorageService(context.secrets);
  databaseService = new DatabaseService();
  llmService = new LlmService();
  schemaService = new SchemaService(databaseService);

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
    vscode.commands.registerCommand('postgres-agent.disconnect', disconnectFromDatabase)
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
      vscode.window.showInformationMessage(
        `Connected to ${database}@${host}. Schema introspected: ${schemaService.getSchema()?.tables.length || 0} tables found.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to connect: ${message}`);
    }
  }

  async function openQueryPanel() {
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

    const panel = QueryPanel.createOrShow(extensionUri, async (query: string) => {
      const schemaContext = schemaService.getSchemaContext();
      const sql = await llmService.generateSql(schemaContext, query);
      const result = await databaseService.executeQuery(sql);
      return { sql, result };
    });

    panel.updateConnectionStatus(true, databaseService.getConnectionInfo());
  }

  async function disconnectFromDatabase() {
    if (!databaseService.isConnected()) {
      vscode.window.showInformationMessage('Not connected to any database.');
      return;
    }

    await databaseService.disconnect();
    schemaService.clear();
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
