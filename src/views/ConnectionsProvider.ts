import * as vscode from 'vscode';
import { SavedConnection } from '../types';
import { ConnectionStorageService } from '../services/connectionStorage';

export class ConnectionItem extends vscode.TreeItem {
  constructor(
    public readonly connection: SavedConnection,
    public readonly isConnected: boolean
  ) {
    super(connection.name, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${connection.user}@${connection.host}:${connection.port}/${connection.database}`;
    this.description = `${connection.host}/${connection.database}`;

    this.iconPath = new vscode.ThemeIcon(
      isConnected ? 'database' : 'circle-outline',
      isConnected ? new vscode.ThemeColor('charts.green') : undefined
    );

    this.contextValue = 'savedConnection';

    this.command = {
      command: 'postgres-agent.connectSaved',
      title: 'Connect',
      arguments: [this],
    };
  }
}

export class AddConnectionItem extends vscode.TreeItem {
  constructor() {
    super('Add Connection...', vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon('add');
    this.contextValue = 'addConnection';

    this.command = {
      command: 'postgres-agent.connect',
      title: 'Add Connection',
    };
  }
}

export class ConnectionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activeConnectionId: string | null = null;

  constructor(private connectionStorage: ConnectionStorageService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setActiveConnection(connectionId: string | null): void {
    this.activeConnectionId = connectionId;
    this.refresh();
  }

  getActiveConnectionId(): string | null {
    return this.activeConnectionId;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const connections = await this.connectionStorage.getSavedConnections();

    const items: vscode.TreeItem[] = connections.map(
      conn => new ConnectionItem(conn, conn.id === this.activeConnectionId)
    );

    items.push(new AddConnectionItem());

    return items;
  }
}
