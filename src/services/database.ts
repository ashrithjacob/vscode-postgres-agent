import { Pool, QueryResult as PgQueryResult } from 'pg';
import { DbCredentials, ColumnInfo, QueryResult, ConditionValidationResult, ConditionIssue, DatabaseSchema } from '../types';

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

  /**
   * Validates conditional statements in SQL to check if they "make sense"
   * by verifying that search patterns might actually match data in the specified columns.
   * If a pattern doesn't match in the used column but does match in another column,
   * it suggests the alternative column.
   */
  async validateConditions(sql: string, schema: DatabaseSchema): Promise<ConditionValidationResult> {
    if (!this.pool) {
      return { hasIssues: false, issues: [] };
    }

    const issues: ConditionIssue[] = [];

    // Extract ILIKE/LIKE conditions from the SQL
    // Pattern matches: column_name ILIKE '%value%' or column_name LIKE '%value%'
    const likePattern = /["']?(\w+)["']?\.?["']?(\w+)["']?\s+(I?LIKE)\s+'([^']+)'/gi;
    // Also match simple column references without table prefix
    const simpleLikePattern = /["']?(\w+)["']?\s+(I?LIKE)\s+'([^']+)'/gi;

    const conditions: Array<{
      tableName: string | null;
      columnName: string;
      operator: string;
      value: string;
      fullMatch: string;
    }> = [];

    // Extract conditions with table prefixes (table.column ILIKE 'value')
    let match;
    while ((match = likePattern.exec(sql)) !== null) {
      conditions.push({
        tableName: match[1],
        columnName: match[2],
        operator: match[3],
        value: match[4],
        fullMatch: match[0]
      });
    }

    // Extract simple conditions (column ILIKE 'value')
    while ((match = simpleLikePattern.exec(sql)) !== null) {
      // Skip if this was already matched as a table.column pattern
      const alreadyMatched = conditions.some(c =>
        c.columnName === match![1] || c.tableName === match![1]
      );
      if (!alreadyMatched) {
        conditions.push({
          tableName: null,
          columnName: match[1],
          operator: match[2],
          value: match[3],
          fullMatch: match[0]
        });
      }
    }

    // For each LIKE/ILIKE condition, check if the value makes sense
    for (const condition of conditions) {
      // Extract the search term (remove % wildcards for matching)
      const searchTerm = condition.value.replace(/%/g, '').toLowerCase();
      if (!searchTerm || searchTerm.length < 2) {
        continue; // Skip very short or empty search terms
      }

      // Find the table this column belongs to
      let targetTable: string | null = condition.tableName;
      if (!targetTable) {
        // Try to find which table has this column
        for (const table of schema.tables) {
          if (table.columns.some(c => c.columnName.toLowerCase() === condition.columnName.toLowerCase())) {
            targetTable = table.name;
            break;
          }
        }
      }

      if (!targetTable) {
        continue; // Couldn't identify the table
      }

      // Check if the search term exists in the specified column
      const hasMatchInColumn = await this.checkValueExists(
        targetTable,
        condition.columnName,
        searchTerm,
        condition.operator.toUpperCase() === 'ILIKE'
      );

      if (!hasMatchInColumn) {
        // Search term doesn't match in the specified column
        // Check if it matches in other string columns of the same table
        const tableSchema = schema.tables.find(t => t.name.toLowerCase() === targetTable!.toLowerCase());
        if (tableSchema) {
          for (const col of tableSchema.columns) {
            // Skip the original column and non-string columns
            if (col.columnName.toLowerCase() === condition.columnName.toLowerCase()) {
              continue;
            }
            if (!this.isStringType(col.dataType)) {
              continue;
            }

            const hasMatchInOtherColumn = await this.checkValueExists(
              targetTable,
              col.columnName,
              searchTerm,
              condition.operator.toUpperCase() === 'ILIKE'
            );

            if (hasMatchInOtherColumn) {
              issues.push({
                originalColumn: condition.columnName,
                suggestedColumn: col.columnName,
                tableName: targetTable,
                searchValue: condition.value,
                operator: condition.operator,
                reason: `No matches found for '${searchTerm}' in column '${condition.columnName}', but matches exist in '${col.columnName}'`
              });
              break; // Found a better column, stop searching
            }
          }
        }
      }
    }

    // Generate suggested SQL if there are issues
    let suggestedSql: string | undefined;
    if (issues.length > 0) {
      suggestedSql = sql;
      for (const issue of issues) {
        // Replace the column name in the SQL, being careful with table prefixes
        const patterns = [
          // With table prefix: table.column
          new RegExp(`(["']?${issue.tableName}["']?\\.["']?)${issue.originalColumn}(["']?\\s+${issue.operator})`, 'gi'),
          // Without table prefix
          new RegExp(`(\\s|\\()["']?${issue.originalColumn}["']?(\\s+${issue.operator})`, 'gi')
        ];

        for (const pattern of patterns) {
          suggestedSql = suggestedSql.replace(pattern, `$1${issue.suggestedColumn}$2`);
        }
      }
    }

    return {
      hasIssues: issues.length > 0,
      issues,
      suggestedSql
    };
  }

  /**
   * Check if a search value exists in a specific column using ILIKE/LIKE
   */
  private async checkValueExists(
    tableName: string,
    columnName: string,
    searchValue: string,
    caseInsensitive: boolean
  ): Promise<boolean> {
    if (!this.pool) {
      return false;
    }

    try {
      const operator = caseInsensitive ? 'ILIKE' : 'LIKE';
      const query = `
        SELECT 1 FROM ${this.quoteIdentifier(tableName)}
        WHERE ${this.quoteIdentifier(columnName)} ${operator} $1
        LIMIT 1
      `;
      const result = await this.pool.query(query, [`%${searchValue}%`]);
      return result.rowCount !== null && result.rowCount > 0;
    } catch {
      // If query fails, assume no issues to avoid false positives
      return true;
    }
  }

  private isStringType(dataType: string): boolean {
    const stringTypes = [
      'text', 'character varying', 'varchar', 'character', 'char',
      'name', 'citext', 'uuid'
    ];
    return stringTypes.some(t => dataType.toLowerCase().includes(t));
  }
}
