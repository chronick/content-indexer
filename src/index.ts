import { createServer } from "./server.js";
import { startWatcher } from "./watcher.js";
import { getConfig, getDbPath } from "./config.js";
import { getDb } from "./db/connection.js";
import { checkOllama } from "./embeddings.js";
import fs from "fs";

async function main() {
  const config = getConfig();

  // Ensure content dir exists
  fs.mkdirSync(config.CONTENT_DIR, { recursive: true });

  // Initialize DB
  getDb(getDbPath(config));
  console.log(`Database: ${getDbPath(config)}`);
  console.log(`Content dir: ${config.CONTENT_DIR}`);

  // Check Ollama availability
  const ollamaReady = await checkOllama();
  if (!ollamaReady) {
    console.warn(
      `WARNING: Ollama not available at ${config.OLLAMA_HOST} or model '${config.EMBED_MODEL}' not found.`,
    );
    console.warn("Embedding features will fail until Ollama is running.");
  } else {
    console.log(`Ollama: ${config.OLLAMA_HOST} (model: ${config.EMBED_MODEL})`);
  }

  // Start HTTP server
  const server = await createServer();
  await server.listen({ port: config.PORT, host: "0.0.0.0" });
  console.log(`HTTP server: http://localhost:${config.PORT}`);

  // Start file watcher
  const watcher = startWatcher(config.CONTENT_DIR);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await watcher.close();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
