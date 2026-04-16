# content-indexer

Directory vector index service with HTTP API, MCP search server, and CLI.

## Tech

- TypeScript, Fastify 5, better-sqlite3, sqlite-vec, Drizzle ORM
- Ollama (nomic-embed-text) for embeddings
- chokidar for directory watching
- @modelcontextprotocol/sdk for MCP server

## Run

```bash
npx tsx src/index.ts                  # Start service (HTTP + watcher)
npx tsx src/cli.ts rebuild            # Rebuild entire index
npx tsx src/cli.ts stats              # Index statistics
npx tsx src/cli.ts search "query"     # Search from CLI
npx tsx src/cli.ts mcp                # Run MCP stdio server
```

## API

- `GET /health` — health check
- `GET /search?q=...&limit=10` — combined semantic + keyword search
- `GET /search/semantic?q=...` — semantic only
- `GET /search/keyword?q=...` — keyword/FTS5 only
- `GET /stats` — index statistics
- `POST /reindex` — full rebuild
- `POST /reindex/:path` — reindex single file

## MCP Tools

- `search_content` — semantic search with optional tag filter
- `content_stats` — index statistics
- `lookup_content` — find by URL or title

## Env

```
CONTENT_DIR=~/rig/data/bookmarks/content
DATA_DIR=~/rig/data/content-index
OLLAMA_HOST=http://localhost:11434
EMBED_MODEL=nomic-embed-text
PORT=7800
```

## Architecture

- Watches CONTENT_DIR for .md file changes (chokidar)
- Parses frontmatter + chunks content (~500 tokens per chunk)
- Embeds chunks via Ollama, stores in sqlite-vec
- FTS5 for keyword search alongside vector search
- Content-agnostic: indexes any directory of markdown files
