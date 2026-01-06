import { LlmConfig, SqlVerificationResult } from '../types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class LlmService {
  private config: LlmConfig | null = null;

  setConfig(config: LlmConfig): void {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  async generateSql(schemaContext: string, userQuestion: string): Promise<string> {
    if (!this.config) {
      throw new Error('LLM not configured. Please configure the LLM first.');
    }

    const systemPrompt = `You are a PostgreSQL expert. Convert natural language questions to valid PostgreSQL queries.

Database Schema:
${schemaContext}

Rules:
1. Return ONLY the SQL query, no explanations, no markdown code blocks, just raw SQL
2. Use proper escaping for identifiers if needed
3. Limit results to 100 rows unless the user specifies otherwise
4. Never generate destructive operations (DROP, DELETE, TRUNCATE, UPDATE, INSERT, ALTER, CREATE, GRANT, REVOKE)
5. If the question is ambiguous, make reasonable assumptions based on the schema
6. Use appropriate JOINs when querying related tables
7. Always use proper column names from the schema provided`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userQuestion },
    ];

    const response = await this.callApi(messages);
    return this.extractSql(response);
  }

  private async callApi(messages: ChatMessage[]): Promise<string> {
    if (!this.config) {
      throw new Error('LLM not configured');
    }

    const url = this.normalizeUrl(this.config.baseUrl);

    const requestBody = {
      model: this.config.model,
      messages,
      temperature: 0.1,
      max_tokens: 2048,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as ChatCompletionResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from LLM');
    }

    return data.choices[0].message.content;
  }

  private normalizeUrl(baseUrl: string): string {
    let url = baseUrl.trim();

    // Remove trailing slash
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }

    // Add /chat/completions if not present
    if (!url.endsWith('/chat/completions')) {
      if (!url.endsWith('/v1')) {
        url = `${url}/v1`;
      }
      url = `${url}/chat/completions`;
    }

    return url;
  }

  private extractSql(response: string): string {
    let sql = response.trim();

    // Remove markdown code blocks if present
    if (sql.startsWith('```sql')) {
      sql = sql.slice(6);
    } else if (sql.startsWith('```')) {
      sql = sql.slice(3);
    }

    if (sql.endsWith('```')) {
      sql = sql.slice(0, -3);
    }

    return sql.trim();
  }

  async testConnection(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    try {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Say "OK" and nothing else.' },
      ];
      await this.callApi(messages);
      return true;
    } catch {
      return false;
    }
  }

  async verifySql(
    schemaContext: string,
    userQuestion: string,
    generatedSql: string
  ): Promise<SqlVerificationResult> {
    if (!this.config) {
      throw new Error('LLM not configured. Please configure the LLM first.');
    }

    const systemPrompt = `You are a PostgreSQL SQL verification expert. Your job is to verify if a generated SQL query correctly answers the user's question given the database schema.

Database Schema:
${schemaContext}

Analyze the SQL query and respond with a JSON object (no markdown, no code blocks, just raw JSON):
{
  "isValid": boolean,           // true if the SQL correctly answers the question
  "correctedSql": string|null,  // only if SQL needed minor fixes, provide corrected version
  "issues": string[]|null,      // list of issues found (if any)
  "needsClarification": boolean, // true ONLY if the question is fundamentally ambiguous and cannot be reasonably interpreted
  "clarificationQuestion": string|null, // question to ask user ONLY if needsClarification is true
  "confidence": "high"|"medium"|"low" // your confidence in the verification
}

IMPORTANT RULES:
1. Be lenient - only flag issues that would cause incorrect results or errors
2. Set needsClarification to true ONLY for genuinely ambiguous queries where multiple valid interpretations exist and guessing would be wrong
3. Do NOT ask for clarification on minor ambiguities - make reasonable assumptions
4. Examples where clarification IS needed:
   - "show me recent orders" when "recent" could mean last day, week, or month and there's no obvious default
   - "show top customers" when it's unclear if "top" means by order count, total spend, or something else
5. Examples where clarification is NOT needed:
   - Column name typos that can be obviously corrected
   - Missing LIMIT clauses
   - JOIN conditions that are obvious from foreign keys
6. If the SQL is syntactically correct and reasonably answers the question, mark it as valid with high confidence`;

    const userPrompt = `User Question: "${userQuestion}"

Generated SQL:
${generatedSql}

Verify this SQL and respond with JSON only.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.callApi(messages);
    return this.parseVerificationResponse(response);
  }

  private parseVerificationResponse(response: string): SqlVerificationResult {
    try {
      // Clean up potential markdown formatting
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned);

      return {
        isValid: Boolean(parsed.isValid),
        correctedSql: parsed.correctedSql || undefined,
        issues: parsed.issues || undefined,
        needsClarification: Boolean(parsed.needsClarification),
        clarificationQuestion: parsed.clarificationQuestion || undefined,
        confidence: parsed.confidence || 'medium',
      };
    } catch {
      // If parsing fails, assume the SQL is valid to avoid blocking
      return {
        isValid: true,
        needsClarification: false,
        confidence: 'low',
      };
    }
  }

  async regenerateSqlWithClarification(
    schemaContext: string,
    originalQuestion: string,
    clarificationAnswer: string
  ): Promise<string> {
    if (!this.config) {
      throw new Error('LLM not configured. Please configure the LLM first.');
    }

    const systemPrompt = `You are a PostgreSQL expert. Convert natural language questions to valid PostgreSQL queries.

Database Schema:
${schemaContext}

Rules:
1. Return ONLY the SQL query, no explanations, no markdown code blocks, just raw SQL
2. Use proper escaping for identifiers if needed
3. Limit results to 100 rows unless the user specifies otherwise
4. Never generate destructive operations (DROP, DELETE, TRUNCATE, UPDATE, INSERT, ALTER, CREATE, GRANT, REVOKE)
5. Use the clarification provided to resolve any ambiguity
6. Use appropriate JOINs when querying related tables
7. Always use proper column names from the schema provided`;

    const userPrompt = `Original Question: "${originalQuestion}"

User Clarification: "${clarificationAnswer}"

Generate the SQL query based on the original question and the clarification provided.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.callApi(messages);
    return this.extractSql(response);
  }

  async fixSql(
    schemaContext: string,
    originalSql: string,
    error: string,
    originalQuestion: string
  ): Promise<string> {
    if (!this.config) {
      throw new Error('LLM not configured. Please configure the LLM first.');
    }

    const systemPrompt = `You are a PostgreSQL expert. Fix SQL queries that have errors.

Database Schema:
${schemaContext}

Rules:
1. Return ONLY the corrected SQL query, no explanations, no markdown code blocks, just raw SQL
2. Fix the error while preserving the original intent of the query
3. Use proper escaping for identifiers if needed
4. Limit results to 100 rows unless specified otherwise
5. Never generate destructive operations (DROP, DELETE, TRUNCATE, UPDATE, INSERT, ALTER, CREATE, GRANT, REVOKE)
6. Use appropriate JOINs when querying related tables
7. Always use proper column names from the schema provided`;

    const userPrompt = `Original Question: "${originalQuestion}"

Original SQL that failed:
${originalSql}

Error message:
${error}

Please fix the SQL query to resolve the error.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.callApi(messages);
    return this.extractSql(response);
  }
}
