import { LlmConfig } from '../types';

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
}
