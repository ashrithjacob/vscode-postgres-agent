import * as vscode from 'vscode';
import { DbCredentials, LlmConfig } from '../types';

const DB_CREDENTIALS_KEY = 'postgres-agent.db-credentials';
const LLM_CONFIG_KEY = 'postgres-agent.llm-config';

export class SecretStorageService {
  constructor(private secretStorage: vscode.SecretStorage) {}

  async saveDbCredentials(credentials: DbCredentials): Promise<void> {
    await this.secretStorage.store(DB_CREDENTIALS_KEY, JSON.stringify(credentials));
  }

  async getDbCredentials(): Promise<DbCredentials | null> {
    const stored = await this.secretStorage.get(DB_CREDENTIALS_KEY);
    if (!stored) {
      return null;
    }
    try {
      return JSON.parse(stored) as DbCredentials;
    } catch {
      return null;
    }
  }

  async deleteDbCredentials(): Promise<void> {
    await this.secretStorage.delete(DB_CREDENTIALS_KEY);
  }

  async saveLlmConfig(config: LlmConfig): Promise<void> {
    await this.secretStorage.store(LLM_CONFIG_KEY, JSON.stringify(config));
  }

  async getLlmConfig(): Promise<LlmConfig | null> {
    const stored = await this.secretStorage.get(LLM_CONFIG_KEY);
    if (!stored) {
      return null;
    }
    try {
      return JSON.parse(stored) as LlmConfig;
    } catch {
      return null;
    }
  }

  async deleteLlmConfig(): Promise<void> {
    await this.secretStorage.delete(LLM_CONFIG_KEY);
  }

  async hasDbCredentials(): Promise<boolean> {
    return (await this.getDbCredentials()) !== null;
  }

  async hasLlmConfig(): Promise<boolean> {
    return (await this.getLlmConfig()) !== null;
  }
}
