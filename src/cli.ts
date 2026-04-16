import { getConfig, getDbPath } from "./config.js";
import { getDb, closeDb } from "./db/connection.js";
import { rebuild, getStats, indexFile } from "./indexer.js";
import { combinedSearch } from "./search.js";
import path from "path";

function usage() {
  console.log(`
content-indexer CLI

Usage:
  npx tsx src/cli.ts <command> [args]

Commands:
  rebuild           Drop and rebuild the entire index
  stats             Show index statistics
  search <query>    Search the index
  index <file>      Index a single file
  mcp               Run MCP stdio server

Environment:
  CONTENT_DIR    Content directory (default: ~/rig/data/bookmarks/content)
  DATA_DIR       Index database directory (default: ~/rig/data/content-index)
  OLLAMA_HOST    Ollama API host (default: http://localhost:11434)
  EMBED_MODEL    Embedding model (default: nomic-embed-text)
`.trim());
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  const config = getConfig();
  getDb(getDbPath(config));

  try {
    switch (command) {
      case "rebuild": {
        console.log("Rebuilding index...");
        const result = await rebuild();
        console.log(
          `Done: ${result.indexed} indexed, ${result.failed} failed`,
        );
        break;
      }

      case "stats": {
        const stats = getStats();
        console.log(`Documents: ${stats.documents}`);
        console.log(`Chunks:    ${stats.chunks}`);
        console.log(`Embeddings: ${stats.embeddings}`);
        if (stats.topTags.length > 0) {
          console.log("\nTop tags:");
          for (const { tag, count } of stats.topTags.slice(0, 10)) {
            console.log(`  ${tag}: ${count}`);
          }
        }
        break;
      }

      case "search": {
        const query = args.slice(1).join(" ");
        if (!query) {
          console.error("Usage: search <query>");
          process.exit(1);
        }
        const results = await combinedSearch(query, 10);
        if (results.length === 0) {
          console.log("No results found.");
        } else {
          for (const r of results) {
            console.log(
              `\n[${r.score.toFixed(3)}] ${r.title || r.path}`,
            );
            if (r.url) console.log(`  URL: ${r.url}`);
            if (r.tags.length) console.log(`  Tags: ${r.tags.join(", ")}`);
            console.log(`  ${r.excerpt.slice(0, 150)}...`);
          }
        }
        break;
      }

      case "index": {
        const filePath = args[1];
        if (!filePath) {
          console.error("Usage: index <file>");
          process.exit(1);
        }
        const fullPath = path.resolve(filePath);
        const indexed = await indexFile(fullPath);
        console.log(indexed ? `Indexed: ${fullPath}` : `Skipped (unchanged): ${fullPath}`);
        break;
      }

      case "mcp": {
        // Dynamic import to avoid loading MCP deps for other commands
        const { runMcpStdio } = await import("./mcp/index.js");
        await runMcpStdio();
        return; // MCP server runs until terminated
      }

      default:
        console.error(`Unknown command: ${command}`);
        usage();
        process.exit(1);
    }
  } finally {
    closeDb();
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
