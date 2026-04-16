# content-indexer

A local-first semantic search engine for directories of markdown files. Indexes content with vector embeddings (via [Ollama](https://ollama.com)) and full-text search (SQLite FTS5), then serves results over HTTP and [MCP](https://modelcontextprotocol.io).

Designed to run as an always-on service that watches a directory and incrementally indexes changes. Content-agnostic — works with any collection of markdown files.

## Features

- **Semantic search** — vector similarity via [sqlite-vec](https://github.com/asg017/sqlite-vec) (768-dim embeddings)
- **Keyword search** — SQLite FTS5 full-text search
- **Combined search** — merges semantic and keyword results, deduplicated by document
- **Incremental indexing** — SHA-256 content hashing, skips unchanged files
- **File watching** — [chokidar](https://github.com/paulmillr/chokidar) monitors the content directory for adds, changes, and deletes
- **HTTP API** — Fastify server with search, stats, lookup, and reindex endpoints
- **MCP server** — Model Context Protocol tools for AI agent integration (HTTP and stdio transports)
- **CLI** — rebuild, search, stats, and index commands
- **Frontmatter-aware** — parses YAML frontmatter for title, URL, tags, and date metadata
- **Local embeddings** — all embedding generation runs locally via Ollama, no API calls

## Requirements

- Node.js 20+
- [Ollama](https://ollama.com) running locally with an embedding model pulled:
  ```bash
  ollama pull nomic-embed-text
  ```

## Install

```bash
git clone https://github.com/chronick/content-indexer.git
cd content-indexer
npm install
```

## Usage

### Service mode (recommended)

Starts the HTTP server and file watcher:

```bash
npx tsx src/index.ts
```

The service will:
- Watch `CONTENT_DIR` for `.md` file changes
- Automatically index new/changed files
- Remove deleted files from the index
- Serve the HTTP API on port 7800

### CLI

```bash
npx tsx src/cli.ts rebuild            # Drop and rebuild entire index
npx tsx src/cli.ts stats              # Show document/chunk/embedding counts
npx tsx src/cli.ts search "query"     # Search from the command line
npx tsx src/cli.ts index path/to.md   # Index a single file
npx tsx src/cli.ts mcp                # Run MCP server over stdio
```

## Configuration

Set via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTENT_DIR` | `~/.content-indexer/content` | Directory of markdown files to index |
| `DATA_DIR` | `~/.content-indexer/data` | Directory for the SQLite index database |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `EMBED_MODEL` | `nomic-embed-text` | Ollama embedding model name |
| `PORT` | `7800` | HTTP server port |

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check with document/chunk counts |
| `GET` | `/search?q=...&limit=10` | Combined semantic + keyword search |
| `GET` | `/search/semantic?q=...` | Semantic search only |
| `GET` | `/search/keyword?q=...` | Keyword/FTS5 search only |
| `GET` | `/recent?days=7&limit=20` | Recently added documents |
| `GET` | `/stats` | Index statistics and top tags |
| `GET` | `/lookup?url=...` | Find document by URL |
| `GET` | `/lookup?title=...` | Find documents by title (partial match) |
| `POST` | `/reindex` | Full index rebuild |
| `POST` | `/reindex/:path` | Reindex a single file |
| `POST` | `/mcp` | MCP HTTP transport (stateless) |

The server binds to `0.0.0.0` by default (all interfaces). Set `HOST=127.0.0.1` or use a firewall if you don't want network access.

### Example

```bash
# Search for articles about rust async
curl 'http://localhost:7800/search?q=rust+async+runtime&limit=5'

# Get recently indexed documents
curl 'http://localhost:7800/recent?days=7'

# Check index health
curl 'http://localhost:7800/health'
```

## MCP Integration

### HTTP transport (for networked clients)

Point your MCP client at `http://localhost:7800/mcp`:

```json
{
  "content-search": {
    "type": "http",
    "url": "http://localhost:7800/mcp"
  }
}
```

### Stdio transport (for local CLI tools like Claude Code)

```json
{
  "content-search": {
    "command": "npx",
    "args": ["tsx", "src/cli.ts", "mcp"],
    "cwd": "/path/to/content-indexer",
    "env": {
      "CONTENT_DIR": "/path/to/your/content",
      "DATA_DIR": "/path/to/index/data"
    }
  }
}
```

### Available tools

| Tool | Description |
|------|-------------|
| `search_content` | Semantic + keyword search with relevance scores |
| `recent_content` | Recently indexed documents (by source date or index date) |
| `content_stats` | Document count, chunk count, top tags |
| `lookup_content` | Find a specific document by URL or title |

## How It Works

1. **Watch** — chokidar monitors `CONTENT_DIR` for `.md` file events (add, change, delete)
2. **Hash** — SHA-256 hash of file content; skip if unchanged
3. **Parse** — extract YAML frontmatter (title, URL, tags, date) and body text
4. **Chunk** — split body into ~500-token chunks at paragraph boundaries, hard-split oversized paragraphs
5. **Embed** — generate 768-dim vectors via Ollama's `/api/embed` endpoint (batches of 32)
6. **Store** — insert into SQLite: documents table (Drizzle ORM), vec_chunks (sqlite-vec), chunks_fts (FTS5)
7. **Search** — query combines vector nearest-neighbor and FTS5 keyword results, deduplicated by document

## Tech Stack

- TypeScript (ESM)
- [Fastify 5](https://fastify.dev) — HTTP server
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [Drizzle ORM](https://orm.drizzle.team/) — database
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — vector search
- [Ollama](https://ollama.com) — local embeddings
- [chokidar](https://github.com/paulmillr/chokidar) — file watching
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server
- [gray-matter](https://github.com/jonschlinkert/gray-matter) — frontmatter parsing
- [Zod](https://zod.dev) — config validation

## License

MIT
