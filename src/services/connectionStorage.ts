import * as vscode from 'vscode';
import { SavedConnection, ChatMessage, ChatHistory, DbCredentials } from '../types';
import { randomUUID } from 'crypto';

const CONNECTIONS_KEY = 'postgres-agent.saved-connections';
const CREDENTIALS_PREFIX = 'postgres-agent.connection-credentials.';
const HISTORY_PREFIX = 'postgres-agent.chat-history.';

export class ConnectionStorageService {
  constructor(
    private globalState: vscode.Memento,
    private secretStorage: vscode.SecretStorage
  ) {}

  async getSavedConnections(): Promise<SavedConnection[]> {
    const connections = this.globalState.get<SavedConnection[]>(CONNECTIONS_KEY, []);
    return connections.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  async saveConnection(name: string, credentials: DbCredentials): Promise<SavedConnection> {
    const connections = await this.getSavedConnections();

    const connection: SavedConnection = {
      id: randomUUID(),
      name,
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      user: credentials.user,
      ssl: credentials.ssl,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    connections.push(connection);
    await this.globalState.update(CONNECTIONS_KEY, connections);

    await this.secretStorage.store(
      CREDENTIALS_PREFIX + connection.id,
      credentials.password
    );

    return connection;
  }

  async getCredentials(connectionId: string): Promise<DbCredentials | null> {
    const connections = await this.getSavedConnections();
    const connection = connections.find(c => c.id === connectionId);

    if (!connection) {
      return null;
    }

    const password = await this.secretStorage.get(CREDENTIALS_PREFIX + connectionId);
    if (!password) {
      return null;
    }

    return {
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      password,
      ssl: connection.ssl,
    };
  }

  async deleteConnection(connectionId: string): Promise<void> {
    const connections = await this.getSavedConnections();
    const filtered = connections.filter(c => c.id !== connectionId);
    await this.globalState.update(CONNECTIONS_KEY, filtered);

    await this.secretStorage.delete(CREDENTIALS_PREFIX + connectionId);
    await this.clearChatHistory(connectionId);
  }

  async updateLastUsed(connectionId: string): Promise<void> {
    const connections = await this.getSavedConnections();
    const connection = connections.find(c => c.id === connectionId);

    if (connection) {
      connection.lastUsedAt = Date.now();
      await this.globalState.update(CONNECTIONS_KEY, connections);
    }
  }

  async renameConnection(connectionId: string, newName: string): Promise<void> {
    const connections = await this.getSavedConnections();
    const connection = connections.find(c => c.id === connectionId);

    if (connection) {
      connection.name = newName;
      await this.globalState.update(CONNECTIONS_KEY, connections);
    }
  }

  getChatHistory(connectionId: string): ChatHistory {
    const messages = this.globalState.get<ChatMessage[]>(HISTORY_PREFIX + connectionId, []);
    return { connectionId, messages };
  }

  async saveChatMessage(connectionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
    const history = this.getChatHistory(connectionId);

    const fullMessage: ChatMessage = {
      ...message,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    history.messages.push(fullMessage);
    await this.globalState.update(HISTORY_PREFIX + connectionId, history.messages);

    return fullMessage;
  }

  async clearChatHistory(connectionId: string): Promise<void> {
    await this.globalState.update(HISTORY_PREFIX + connectionId, []);
  }

  async connectionExists(name: string): Promise<boolean> {
    const connections = await this.getSavedConnections();
    return connections.some(c => c.name.toLowerCase() === name.toLowerCase());
  }
}
