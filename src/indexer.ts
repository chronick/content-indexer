import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";
import { eq } from "drizzle-orm";
import { getDb, getSqlite } from "./db/connection.js";
import { documents, chunks } from "./db/schema.js";
import { chunkMarkdown } from "./chunker.js";
import { embed } from "./embeddings.js";
import { getConfig, getDbPath } from "./config.js";

function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(full));
    } else if (entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Index a single file. Skips if content hash is unchanged.
 * Returns true if the file was (re-)indexed, false if skipped.
 */
export async function indexFile(filePath: string): Promise<boolean> {
  const config = getConfig();
  const db = getDb(getDbPath(config));
  const sqlite = getSqlite();
  const relativePath = path.relative(config.CONTENT_DIR, filePath);

  const raw = fs.readFileSync(filePath, "utf-8");
  const contentHash = hashContent(raw);

  // Check if already indexed with same hash
  const existing = db
    .select()
    .from(documents)
    .where(eq(documents.path, relativePath))
    .get();

  if (existing && existing.contentHash === contentHash) {
    return false; // unchanged
  }

  // Parse frontmatter
  const { data: frontmatter, content } = matter(raw);
  const title = (frontmatter.title as string) || null;
  const url = (frontmatter.url as string) || null;
  const tags = frontmatter.tags
    ? JSON.stringify(
        Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags],
      )
    : null;

  // Chunk content
  const textChunks = chunkMarkdown(content);

  if (textChunks.length === 0) {
    return false; // no meaningful content
  }

  // Generate embeddings
  let embeddings: number[][];
  try {
    embeddings = await embed(textChunks.map((c) => c.content));
  } catch (err) {
    console.error(
      `  Failed to embed ${relativePath}: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }

  // Transactional upsert
  const txn = sqlite.transaction(() => {
    // Remove old data if exists
    if (existing) {
      // Delete vec entries for old chunks
      const oldChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(eq(chunks.documentId, existing.id))
        .all();

      for (const c of oldChunks) {
        sqlite
          .prepare("DELETE FROM vec_chunks WHERE rowid = ?")
          .run(c.id);
      }

      db.delete(chunks).where(eq(chunks.documentId, existing.id)).run();
      db.delete(documents).where(eq(documents.id, existing.id)).run();
    }

    // Insert document
    const docResult = db
      .insert(documents)
      .values({
        path: relativePath,
        title,
        url,
        tags,
        contentHash,
        chunkCount: textChunks.length,
        indexedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    const docId = Number(docResult.lastInsertRowid);

    // Insert chunks + embeddings
    const insertChunk = sqlite.prepare(
      "INSERT INTO chunks (document_id, chunk_index, content, start_offset, end_offset) VALUES (?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < textChunks.length; i++) {
      const tc = textChunks[i];
      const chunkResult = insertChunk.run(
        docId,
        tc.index,
        tc.content,
        tc.startOffset,
        tc.endOffset,
      );
      const chunkId = Number(chunkResult.lastInsertRowid);

      // sqlite-vec + better-sqlite3: multiple ? params don't work with vec0.
      // Interpolate the integer rowid into SQL (safe — always a controlled integer).
      const vecJson = JSON.stringify(embeddings[i]);
      sqlite
        .prepare(
          `INSERT INTO vec_chunks (rowid, embedding) VALUES (${chunkId}, ?)`,
        )
        .run(vecJson);
    }
  });

  txn();
  return true;
}

/**
 * Remove a file from the index.
 */
export function removeFile(filePath: string): boolean {
  const config = getConfig();
  const db = getDb(getDbPath(config));
  const sqlite = getSqlite();
  const relativePath = path.relative(config.CONTENT_DIR, filePath);

  const existing = db
    .select()
    .from(documents)
    .where(eq(documents.path, relativePath))
    .get();

  if (!existing) return false;

  // Delete vec entries
  const docChunks = db
    .select({ id: chunks.id })
    .from(chunks)
    .where(eq(chunks.documentId, existing.id))
    .all();

  const txn = sqlite.transaction(() => {
    for (const c of docChunks) {
      sqlite.prepare("DELETE FROM vec_chunks WHERE rowid = ?").run(c.id);
    }
    db.delete(chunks).where(eq(chunks.documentId, existing.id)).run();
    db.delete(documents).where(eq(documents.id, existing.id)).run();
  });

  txn();
  return true;
}

/**
 * Rebuild the entire index from scratch.
 */
export async function rebuild(): Promise<{ indexed: number; failed: number }> {
  const config = getConfig();
  const db = getDb(getDbPath(config));
  const sqlite = getSqlite();

  // Clear all data
  sqlite.exec("DELETE FROM vec_chunks");
  db.delete(chunks).run();
  db.delete(documents).run();

  // Find all .md files in content dir
  if (!fs.existsSync(config.CONTENT_DIR)) {
    console.log(`Content directory does not exist: ${config.CONTENT_DIR}`);
    return { indexed: 0, failed: 0 };
  }

  const files = findMarkdownFiles(config.CONTENT_DIR);

  console.log(`Rebuilding index: ${files.length} files found`);

  let indexed = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const wasIndexed = await indexFile(file);
      if (wasIndexed) indexed++;
      if ((i + 1) % 50 === 0) {
        console.log(`  Progress: ${i + 1}/${files.length}`);
      }
    } catch (err) {
      console.error(
        `  Error indexing ${path.basename(file)}: ${err instanceof Error ? err.message : err}`,
      );
      failed++;
    }
  }

  return { indexed, failed };
}

/**
 * Get index statistics.
 */
export function getStats() {
  const config = getConfig();
  const db = getDb(getDbPath(config));
  const sqlite = getSqlite();

  const docCount = db.select().from(documents).all().length;
  const chunkCount = db.select().from(chunks).all().length;

  const vecCount = sqlite
    .prepare("SELECT count(*) as cnt FROM vec_chunks")
    .get() as { cnt: number };

  // Top tags
  const allDocs = db
    .select({ tags: documents.tags })
    .from(documents)
    .all()
    .filter((d) => d.tags);

  const tagCounts = new Map<string, number>();
  for (const doc of allDocs) {
    try {
      const tags = JSON.parse(doc.tags!) as string[];
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    } catch {
      // skip malformed
    }
  }

  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  return {
    documents: docCount,
    chunks: chunkCount,
    embeddings: vecCount?.cnt || 0,
    topTags,
  };
}
