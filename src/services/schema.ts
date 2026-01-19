import { ColumnInfo, DatabaseSchema, TableSchema } from '../types';
import { DatabaseService } from './database';

export class SchemaService {
  private schema: DatabaseSchema | null = null;
  private schemaContext: string = '';

  constructor(private databaseService: DatabaseService) {}

  async refresh(): Promise<void> {
    const columns = await this.databaseService.introspectSchema();

    // Fetch sample values for string columns
    await this.enrichWithSampleValues(columns);

    this.schema = this.buildSchema(columns);
    this.schemaContext = this.formatSchemaContext(this.schema);
  }

  private isStringType(dataType: string): boolean {
    const stringTypes = [
      'text', 'character varying', 'varchar', 'character', 'char',
      'name', 'citext', 'uuid'
    ];
    return stringTypes.some(t => dataType.toLowerCase().includes(t));
  }

  private async enrichWithSampleValues(columns: ColumnInfo[]): Promise<void> {
    // Fetch sample values for string columns (limit to avoid slow queries on large tables)
    const stringColumns = columns.filter(col => this.isStringType(col.dataType));

    // Process in parallel with a reasonable concurrency
    const batchSize = 10;
    for (let i = 0; i < stringColumns.length; i += batchSize) {
      const batch = stringColumns.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (col) => {
          col.sampleValues = await this.databaseService.getSampleValues(
            col.tableName,
            col.columnName,
            5
          );
        })
      );
    }
  }

  getSchema(): DatabaseSchema | null {
    return this.schema;
  }

  getSchemaContext(): string {
    return this.schemaContext;
  }

  hasSchema(): boolean {
    return this.schema !== null && this.schema.tables.length > 0;
  }

  private buildSchema(columns: ColumnInfo[]): DatabaseSchema {
    const tableMap = new Map<string, ColumnInfo[]>();

    for (const col of columns) {
      if (!tableMap.has(col.tableName)) {
        tableMap.set(col.tableName, []);
      }
      tableMap.get(col.tableName)!.push(col);
    }

    const tables: TableSchema[] = [];
    for (const [name, cols] of tableMap) {
      tables.push({ name, columns: cols });
    }

    return { tables };
  }

  private formatSchemaContext(schema: DatabaseSchema): string {
    if (schema.tables.length === 0) {
      return 'No tables found in the public schema.';
    }

    const lines: string[] = [];

    for (const table of schema.tables) {
      lines.push(`Table: ${table.name}`);
      lines.push('Columns:');

      for (const col of table.columns) {
        let colDesc = `  - ${col.columnName}: ${col.dataType}`;

        if (!col.isNullable) {
          colDesc += ' NOT NULL';
        }

        if (col.constraintType === 'PRIMARY KEY') {
          colDesc += ' (PRIMARY KEY)';
        } else if (col.constraintType === 'FOREIGN KEY' && col.foreignTable) {
          colDesc += ` (FK -> ${col.foreignTable}.${col.foreignColumn})`;
        } else if (col.constraintType === 'UNIQUE') {
          colDesc += ' (UNIQUE)';
        }

        if (col.columnDefault) {
          colDesc += ` DEFAULT ${col.columnDefault}`;
        }

        // Add sample values for string columns
        if (col.sampleValues && col.sampleValues.length > 0) {
          const samples = col.sampleValues
            .map(v => `"${v.length > 30 ? v.substring(0, 30) + '...' : v}"`)
            .join(', ');
          colDesc += ` [examples: ${samples}]`;
        }

        lines.push(colDesc);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  clear(): void {
    this.schema = null;
    this.schemaContext = '';
  }
}
