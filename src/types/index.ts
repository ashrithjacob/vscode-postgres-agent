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
  type: 'query' | 'ready' | 'error' | 'result' | 'status' | 'sql';
  payload?: unknown;
}
