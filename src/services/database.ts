import { Pool, QueryResult as PgQueryResult } from 'pg';
import { DbCredentials, ColumnInfo, QueryResult } from '../types';

export class DatabaseService {
  private pool: Pool | null = null;
  private credentials: DbCredentials | null = null;

  async connect(credentials: DbCredentials): Promise<void> {
    if (this.pool) {
      await this.disconnect();
    }

    this.pool = new Pool({
      host: credentials.host,
      port: credentials.port,
      user: credentials.user,
      password: credentials.password,
      database: credentials.database,
      ssl: credentials.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await this.pool.connect();
    client.release();
    this.credentials = credentials;
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.credentials = null;
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  getConnectionInfo(): string {
    if (!this.credentials) {
      return 'Not connected';
    }
    return `${this.credentials.user}@${this.credentials.host}:${this.credentials.port}/${this.credentials.database}`;
  }

  async introspectSchema(): Promise<ColumnInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const query = `
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        tc.constraint_type,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column
      FROM information_schema.columns c
      LEFT JOIN information_schema.key_column_usage kcu
        ON c.table_schema = kcu.table_schema
        AND c.table_name = kcu.table_name
        AND c.column_name = kcu.column_name
      LEFT JOIN information_schema.table_constraints tc
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
        AND tc.constraint_type = 'FOREIGN KEY'
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position;
    `;

    const result = await this.pool.query(query);

    return result.rows.map(row => ({
      tableName: row.table_name,
      columnName: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable === 'YES',
      columnDefault: row.column_default,
      constraintType: row.constraint_type,
      foreignTable: row.foreign_table,
      foreignColumn: row.foreign_column,
    }));
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    // Validate that the query is read-only
    const normalizedSql = sql.trim().toUpperCase();
    const forbiddenKeywords = [
      'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
      'TRUNCATE', 'GRANT', 'REVOKE', 'COPY', 'EXECUTE'
    ];

    for (const keyword of forbiddenKeywords) {
      if (normalizedSql.startsWith(keyword) || normalizedSql.includes(` ${keyword} `)) {
        throw new Error(`Forbidden operation: ${keyword} queries are not allowed. Only SELECT queries are permitted.`);
      }
    }

    const startTime = Date.now();
    const result: PgQueryResult = await this.pool.query(sql);
    const executionTime = Date.now() - startTime;

    const columns = result.fields?.map(f => f.name) || [];
    const rows = result.rows || [];

    return {
      columns,
      rows,
      rowCount: result.rowCount || 0,
      executionTime,
    };
  }

  async testConnection(): Promise<boolean> {
    if (!this.pool) {
      return false;
    }
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async getSampleValues(tableName: string, columnName: string, limit: number = 5): Promise<string[]> {
    if (!this.pool) {
      return [];
    }

    try {
      // Get most common non-null values for the column
      const query = `
        SELECT ${this.quoteIdentifier(columnName)}::text as value, COUNT(*) as cnt
        FROM ${this.quoteIdentifier(tableName)}
        WHERE ${this.quoteIdentifier(columnName)} IS NOT NULL
          AND ${this.quoteIdentifier(columnName)}::text != ''
        GROUP BY ${this.quoteIdentifier(columnName)}
        ORDER BY cnt DESC
        LIMIT $1
      `;
      const result = await this.pool.query(query, [limit]);
      return result.rows.map(row => row.value);
    } catch {
      // If query fails (e.g., column type issues), return empty array
      return [];
    }
  }

  private quoteIdentifier(identifier: string): string {
    // Escape double quotes and wrap in double quotes for safe identifier usage
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  async validateSql(sql: string): Promise<{ isValid: boolean; error?: string }> {
    if (!this.pool) {
      return { isValid: false, error: 'Not connected to database' };
    }

    // First check for forbidden keywords
    const normalizedSql = sql.trim().toUpperCase();
    const forbiddenKeywords = [
      'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
      'TRUNCATE', 'GRANT', 'REVOKE', 'COPY', 'EXECUTE'
    ];

    for (const keyword of forbiddenKeywords) {
      if (normalizedSql.startsWith(keyword) || normalizedSql.includes(` ${keyword} `)) {
        return {
          isValid: false,
          error: `Forbidden operation: ${keyword} queries are not allowed. Only SELECT queries are permitted.`
        };
      }
    }

    // Use EXPLAIN to validate the SQL without executing it
    try {
      await this.pool.query(`EXPLAIN ${sql}`);
      return { isValid: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      return { isValid: false, error: errorMessage };
    }
  }
}
