<div align="center">

# PostgreSQL Agent for VS Code

**Query your PostgreSQL databases using natural language, powered by AI.**

[![VS Code](https://img.shields.io/badge/VS%20Code-v1.85+-007ACC?logo=visual-studio-code&logoColor=white)](https://code.visualstudio.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Ask questions in plain English and get results directly in VS Code.

[Getting Started](#-getting-started) · [Features](#-features) · [Usage](#-usage) · [Troubleshooting](#-troubleshooting)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Natural Language Queries** | Ask questions like "Show me all users who signed up last week" and get SQL + results |
| **Schema Introspection** | Automatically learns your database structure |
| **Flexible LLM Support** | Works with OpenAI, LiteLLM, Ollama, OpenRouter, or any OpenAI-compatible API |
| **Secure Storage** | Credentials stored in VS Code's encrypted SecretStorage |
| **Read-Only Safety** | Only SELECT queries allowed — your data is safe from accidental modifications |
| **Interactive Results** | Sortable, paginated table view for query results |

---

## 🚀 Getting Started

### Prerequisites

- [VS Code](https://code.visualstudio.com/) v1.85 or higher
- [Node.js](https://nodejs.org/) v18+ (for building from source)
- Access to a PostgreSQL database
- An OpenAI-compatible LLM API endpoint

### Installation

<details>
<summary><strong>From VSIX (Recommended)</strong></summary>

Download the latest `.vsix` file from the [Releases](https://github.com/ashrithjacob/vscode-postgres-agent/releases) page.

#### VS Code

**Option 1: Via UI**
1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Click the `...` menu → **Install from VSIX...**
4. Select the downloaded `.vsix` file

**Option 2: Via Command Line**
```bash
code --install-extension vscode-postgres-agent-1.0.0.vsix
```

#### Cursor

**Option 1: Via Command Palette**
1. Open Cursor
2. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
3. Type **Install from VSIX** and select it
4. Navigate to the `.vsix` file and select it

**Option 2: Via Command Line**
```bash
cursor --install-extension vscode-postgres-agent-1.0.0.vsix
```

**Option 3: Drag and Drop**
1. Open Cursor
2. Go to Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Drag the `.vsix` file into the Extensions panel

After installation, reload the editor when prompted.

</details>

<details>
<summary><strong>From Source (Development)</strong></summary>

```bash
# Clone the repository
git clone https://github.com/your-username/vscode-postgres-agent.git
cd vscode-postgres-agent

# Install dependencies
npm install

# Build the extension
npm run compile

# Package as VSIX
npm run build:vsix

# Install in VS Code
code --install-extension vscode-postgres-agent-1.0.0.vsix
# For Cursor users:
cursor --install-extension vscode-postgres-agent-1.0.0.vsix
```


</details>

---

## 📖 Usage

### 1. Configure Your LLM

Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Postgres Agent: Configure LLM**

| Provider | Base URL | Notes |
|----------|----------|-------|
| [OpenAI](https://openai.com/) | `https://api.openai.com` | Requires API key |
| [OpenRouter](https://openrouter.ai/) | `https://openrouter.ai/api` | Multi-model access |
| [Ollama](https://ollama.ai/) | `http://localhost:11434` | Local models, no key needed |
| [LiteLLM](https://litellm.ai/) | `http://localhost:4000` | Proxy for multiple providers |

### 2. Connect to Database

Open Command Palette → **Postgres Agent: Connect to Database**

Enter your connection details:
- **Host** — default: `localhost`
- **Port** — default: `5432`
- **Username** / **Password**
- **Database name**
- **SSL** — Yes/No

The extension automatically introspects your schema upon connection.

### 3. Query with Natural Language

Open Command Palette → **Postgres Agent: Open Query Panel**

Type your question and press **Run Query** or `Ctrl+Enter`:

```
Show me all orders from the last 7 days with customer names
```

The extension generates SQL, executes it safely, and displays results in an interactive table.

---

## 🎯 Example Queries

```sql
-- These are example natural language prompts, not SQL!

"Show me all users who registered this month"
"What are the top 10 products by total sales?"
"List all orders with their items and customer emails"
"Count how many records are in each table"
"Find all users whose email contains 'gmail'"
"Show me the average order value by month"
```

---

## ⌨️ Commands

| Command | Description |
|---------|-------------|
| `Postgres Agent: Configure LLM` | Set up your LLM API connection |
| `Postgres Agent: Connect to Database` | Connect to a PostgreSQL database |
| `Postgres Agent: Open Query Panel` | Open the natural language query interface |
| `Postgres Agent: Disconnect` | Disconnect from the current database |

---

## 🔒 Security

- **Encrypted Storage** — All credentials stored in VS Code's SecretStorage
- **Read-Only Mode** — Only `SELECT` queries are executed; `INSERT`, `UPDATE`, `DELETE`, `DROP` are blocked
- **Privacy** — Only your schema is sent to the LLM for context, never your actual data

---

## 🔧 Troubleshooting

<details>
<summary><strong>"LLM connection test failed"</strong></summary>

- Verify your base URL includes the protocol (`http://` or `https://`)
- Check that your API key is valid
- For local models (Ollama), ensure the server is running

</details>

<details>
<summary><strong>"Failed to connect to database"</strong></summary>

- Verify PostgreSQL is running and accessible
- Double-check credentials (host, port, username, password, database)
- If using SSL, ensure certificates are properly configured

</details>

<details>
<summary><strong>"Forbidden operation" error</strong></summary>

- The extension only allows `SELECT` queries for safety
- Use a dedicated database client for write operations

</details>

---

## 🛠️ Development

```bash
npm install          # Install dependencies
npm run watch        # Watch mode (auto-rebuild)
npm run package      # Production build
npm run build:vsix   # Create VSIX package
npm run lint         # Run ESLint
```

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a [Pull Request](https://github.com/your-username/vscode-postgres-agent/pulls).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
