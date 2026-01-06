# PostgreSQL Agent for VS Code

Query your PostgreSQL databases using natural language, powered by AI. Ask questions in plain English and get results directly in VS Code.

## Features

- **Natural Language Queries**: Ask questions like "Show me all users who signed up last week" and get SQL + results
- **Automatic Schema Introspection**: The extension automatically learns your database structure
- **Flexible LLM Support**: Works with any OpenAI-compatible API (OpenAI, LiteLLM, Ollama, OpenRouter, etc.)
- **Secure Credential Storage**: All credentials are stored in VS Code's encrypted secret storage
- **Read-Only Safety**: Only SELECT queries are allowed - your data is safe from accidental modifications
- **Interactive Results**: Sortable, paginated table view for query results

## Installation

### From Source (Development)

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/vscode-postgres-agent.git
   cd vscode-postgres-agent
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run compile
   ```

3. Package the extension:
   ```bash
   npm run build:vsix
   ```

4. Install in VS Code:
   ```bash
   code --install-extension vscode-postgres-agent-0.1.0.vsix
   ```

   Or in VS Code: `Extensions` → `...` → `Install from VSIX...`

## Usage

### 1. Configure LLM

Run the command: **Postgres Agent: Configure LLM** (`Ctrl+Shift+P` → type "Postgres Agent")

Enter:
- **Base URL**: Your OpenAI-compatible API endpoint
  - OpenAI: `https://api.openai.com`
  - LiteLLM: `http://localhost:4000`
  - Ollama: `http://localhost:11434`
  - OpenRouter: `https://openrouter.ai/api`
- **API Key**: Your API key (or any string for local models)
- **Model**: The model name (e.g., `gpt-4`, `claude-3-opus`, `llama2`)

### 2. Connect to Database

Run the command: **Postgres Agent: Connect to Database**

Enter your PostgreSQL connection details:
- Host (default: `localhost`)
- Port (default: `5432`)
- Username
- Password
- Database name
- SSL (Yes/No)

The extension will automatically introspect your database schema.

### 3. Start Querying

Run the command: **Postgres Agent: Open Query Panel**

Type your question in plain English and press **Run Query** (or `Ctrl+Enter`):

```
Show me all orders from the last 7 days with customer names
```

The extension will:
1. Generate the SQL query using your configured LLM
2. Execute it against your database
3. Display results in an interactive table

## Commands

| Command | Description |
|---------|-------------|
| `Postgres Agent: Configure LLM` | Set up your LLM API connection |
| `Postgres Agent: Connect to Database` | Connect to a PostgreSQL database |
| `Postgres Agent: Open Query Panel` | Open the natural language query interface |
| `Postgres Agent: Disconnect` | Disconnect from the current database |

## Example Queries

- "Show me all users who registered this month"
- "What are the top 10 products by total sales?"
- "List all orders with their items and customer emails"
- "Count how many records are in each table"
- "Find all users whose email contains 'gmail'"
- "Show me the average order value by month"

## Security

- **Credentials**: Stored in VS Code's encrypted SecretStorage
- **Read-Only**: Only SELECT queries are allowed; INSERT, UPDATE, DELETE, DROP, etc. are blocked
- **Schema Context**: Your schema is sent to the LLM for context, but no actual data is shared

## Troubleshooting

### "LLM connection test failed"
- Verify your base URL is correct and includes the protocol (`http://` or `https://`)
- Check your API key is valid
- For local models, ensure the server is running

### "Failed to connect to database"
- Verify PostgreSQL is running and accessible
- Check credentials are correct
- If using SSL, ensure certificates are properly configured

### "Forbidden operation" error
- The extension only allows SELECT queries
- If you need to modify data, use a different tool

## Development

```bash
# Install dependencies
npm install

# Watch mode (auto-rebuild on changes)
npm run watch

# Build for production
npm run package

# Create VSIX package
npm run build:vsix
```

## License

MIT
