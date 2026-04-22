import { watch } from "chokidar";
import path from "path";
import { indexFile, removeFile } from "./indexer.js";

/**
 * Watch a directory for .md file changes and update the index.
 * Processes changes sequentially to avoid SQLite contention.
 */
export function startWatcher(contentDir: string) {
  const queue: Array<{ type: "add" | "change" | "unlink"; filePath: string }> =
    [];
  let processing = false;

  async function processQueue() {
    if (processing || queue.length === 0) return;
    processing = true;

    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        if (job.type === "unlink") {
          const removed = removeFile(job.filePath);
          if (removed) {
            console.log(`[watcher] Removed: ${path.basename(job.filePath)}`);
          }
        } else {
          const indexed = await indexFile(job.filePath);
          if (indexed) {
            console.log(
              `[watcher] Indexed: ${path.basename(job.filePath)}`,
            );
          }
        }
      } catch (err) {
        console.error(
          `[watcher] Error processing ${path.basename(job.filePath)}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    processing = false;
  }

  // chokidar v4 dropped glob pattern support — watch the directory and
  // filter for .md files in the event handlers.
  const isMarkdown = (filePath: string) => filePath.endsWith(".md");

  const watcher = watch(contentDir, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on("add", (filePath) => {
    if (!isMarkdown(filePath)) return;
    queue.push({ type: "add", filePath });
    processQueue();
  });

  watcher.on("change", (filePath) => {
    if (!isMarkdown(filePath)) return;
    queue.push({ type: "change", filePath });
    processQueue();
  });

  watcher.on("unlink", (filePath) => {
    if (!isMarkdown(filePath)) return;
    queue.push({ type: "unlink", filePath });
    processQueue();
  });

  watcher.on("error", (err: unknown) => {
    console.error(`[watcher] Error: ${err instanceof Error ? err.message : String(err)}`);
  });

  console.log(`[watcher] Watching ${contentDir} for .md changes`);
  return watcher;
}
