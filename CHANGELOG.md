# Changelog

All notable changes to the PostgreSQL Agent extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Smart Condition Validation**: Automatically detects and fixes SQL queries where WHERE conditions target the wrong columns
  - Validates ILIKE/LIKE conditions against actual database data after query generation
  - If a search term finds no matches in the specified column but matches exist in another column, the query is automatically corrected
  - Uses LLM to intelligently rewrite queries with correct column references
  - Works transparently in the background for better query results with less manual debugging

## [1.0.8] - 2025-01-19

### Added
- Long conversation history with context awareness for the AI agent
- Cleaner UI improvements

## [1.0.7] - 2025-01-19

### Added
- Clear chat option to reset conversation history

### Changed
- Separated chat histories from sessions for better organization

### Fixed
- Removed duplicate loading bar

## [1.0.6] - 2025-01-19

### Added
- SQL syntax validation with automatic retry mechanism
- LLM-based SQL verification and correction

## [1.0.5] - 2025-01-19

### Added
- More context added to schema information (sample values for string columns)

## [1.0.4] - 2025-01-18

### Added
- Connection persistence for saved database connections
- Query editing capability before execution
- Results display in a separate panel window
- Query validation checks

## [1.0.0] - 2025-01-17

### Added
- Initial release
- Natural language to SQL query generation
- PostgreSQL database connection management
- Schema introspection with table and column information
- LLM configuration (OpenAI-compatible APIs)
- Secure credential storage using VS Code's secret storage
- Read-only query execution (SELECT only)
- Query results display with row counts and execution time

[Unreleased]: https://github.com/ash/vscode-postgres-agent/compare/v1.0.8...HEAD
[1.0.8]: https://github.com/ash/vscode-postgres-agent/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/ash/vscode-postgres-agent/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/ash/vscode-postgres-agent/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/ash/vscode-postgres-agent/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/ash/vscode-postgres-agent/compare/v1.0.0...v1.0.4
[1.0.0]: https://github.com/ash/vscode-postgres-agent/releases/tag/v1.0.0
