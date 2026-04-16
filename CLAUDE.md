# content-indexer

Directory vector index service with HTTP API, MCP search server, and CLI.

## Tech

- TypeScript, Fastify 5, better-sqlite3, sqlite-vec, Drizzle ORM
- Ollama (nomic-embed-text) for local embeddings
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
- `GET /recent?days=7&limit=20` — recently added documents
- `GET /stats` — index statistics
- `GET /lookup?url=...` — find document by URL
- `POST /reindex` — full rebuild
- `POST /reindex/:path` — reindex single file
- `POST /mcp` — MCP HTTP transport (stateless)

## MCP Tools

- `search_content` — semantic + keyword search
- `recent_content` — recently added documents
- `content_stats` — index statistics
- `lookup_content` — find by URL or title

## Env

```
CONTENT_DIR=./content                  # Default: ~/.content-indexer/content
DATA_DIR=./data                        # Default: ~/.content-indexer/data
OLLAMA_HOST=http://localhost:11434
EMBED_MODEL=nomic-embed-text
PORT=7800
```

## Architecture

- Watches CONTENT_DIR for .md file changes (chokidar)
- Parses frontmatter + chunks content (~500 tokens per chunk)
- Embeds chunks via Ollama, stores in sqlite-vec (768 dimensions)
- FTS5 for keyword search alongside vector search
- Content-agnostic: indexes any directory of markdown files
- Incremental: skips files with unchanged content hash
