export interface DbCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ColumnInfo {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  constraintType: string | null;
  foreignTable: string | null;
  foreignColumn: string | null;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
}

export interface DatabaseSchema {
  tables: TableSchema[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;
}

export interface WebviewMessage {
  type: 'query' | 'ready' | 'error' | 'result' | 'status' | 'sql' | 'verification' | 'clarification' | 'clarificationResponse' | 'runEditedSql' | 'fixQuery' | 'validationError' | 'validationSuccess' | 'history';
  payload?: unknown;
}

export interface SqlValidationResult {
  isValid: boolean;
  error?: string;
}

export interface SqlVerificationResult {
  isValid: boolean;
  correctedSql?: string;
  issues?: string[];
  needsClarification: boolean;
  clarificationQuestion?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl?: boolean;
  createdAt: number;
  lastUsedAt: number;
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'sql' | 'result' | 'error';
  content: string;
  timestamp: number;
  sql?: string;
  rowCount?: number;
}

export interface ChatHistory {
  connectionId: string;
  messages: ChatMessage[];
}
