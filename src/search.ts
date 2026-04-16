import { eq, inArray } from "drizzle-orm";
import { getDb, getSqlite } from "./db/connection.js";
import { documents, chunks } from "./db/schema.js";
import { embedQuery } from "./embeddings.js";
import { getConfig, getDbPath } from "./config.js";

export interface SearchResult {
  documentId: number;
  path: string;
  title: string | null;
  url: string | null;
  tags: string[];
  excerpt: string;
  score: number;
  source: "semantic" | "keyword";
}

/**
 * Semantic search using sqlite-vec nearest neighbor.
 */
export async function semanticSearch(
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  const config = getConfig();
  const db = getDb(getDbPath(config));
  const sqlite = getSqlite();

  const queryEmbedding = await embedQuery(query);
  const vecJson = JSON.stringify(queryEmbedding);

  const vecResults = sqlite
    .prepare(
      `SELECT rowid, distance
       FROM vec_chunks
       WHERE embedding MATCH vec_f32(?)
       ORDER BY distance
       LIMIT ?`,
    )
    .all(vecJson, limit * 2) as Array<{
    rowid: number;
    distance: number;
  }>;

  if (vecResults.length === 0) return [];

  const chunkIds = vecResults.map((r) => r.rowid);
  const distanceMap = new Map(vecResults.map((r) => [r.rowid, r.distance]));

  const matchedChunks = db
    .select()
    .from(chunks)
    .where(inArray(chunks.id, chunkIds))
    .all();

  // Group by document, take best score
  const docScores = new Map<
    number,
    { score: number; excerpt: string }
  >();

  for (const chunk of matchedChunks) {
    const distance = distanceMap.get(chunk.id) || 1;
    const score = 1 - distance; // convert distance to similarity

    const existing = docScores.get(chunk.documentId);
    if (!existing || score > existing.score) {
      docScores.set(chunk.documentId, {
        score,
        excerpt: chunk.content.slice(0, 300),
      });
    }
  }

  const docIds = [...docScores.keys()];
  const docs = db
    .select()
    .from(documents)
    .where(inArray(documents.id, docIds))
    .all();

  return docs
    .map((doc) => {
      const match = docScores.get(doc.id)!;
      return {
        documentId: doc.id,
        path: doc.path,
        title: doc.title,
        url: doc.url,
        tags: doc.tags ? (JSON.parse(doc.tags) as string[]) : [],
        excerpt: match.excerpt,
        score: match.score,
        source: "semantic" as const,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Sanitize a free-text query for FTS5. FTS5 has special characters
 * (quotes, parens, colons, brackets, hyphens) that can break the parser.
 * We extract bareword tokens and OR them together so the search is
 * forgiving rather than strict.
 */
function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return "";
  // Quote each token to avoid any remaining FTS5 operator interpretation,
  // and OR them so partial matches still rank.
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

/**
 * Keyword search using FTS5.
 */
export function keywordSearch(query: string, limit = 10): SearchResult[] {
  const config = getConfig();
  const db = getDb(getDbPath(config));
  const sqlite = getSqlite();

  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];

  const ftsResults = sqlite
    .prepare(
      `SELECT rowid, rank
       FROM chunks_fts
       WHERE chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(ftsQuery, limit * 2) as Array<{ rowid: number; rank: number }>;

  if (ftsResults.length === 0) return [];

  const chunkIds = ftsResults.map((r) => r.rowid);
  const rankMap = new Map(ftsResults.map((r) => [r.rowid, r.rank]));

  const matchedChunks = db
    .select()
    .from(chunks)
    .where(inArray(chunks.id, chunkIds))
    .all();

  // Group by document
  const docScores = new Map<
    number,
    { score: number; excerpt: string }
  >();

  for (const chunk of matchedChunks) {
    const rank = rankMap.get(chunk.id) || 0;
    const score = -rank; // FTS5 rank is negative, lower is better

    const existing = docScores.get(chunk.documentId);
    if (!existing || score > existing.score) {
      docScores.set(chunk.documentId, {
        score,
        excerpt: chunk.content.slice(0, 300),
      });
    }
  }

  const docIds = [...docScores.keys()];
  const docs = db
    .select()
    .from(documents)
    .where(inArray(documents.id, docIds))
    .all();

  return docs
    .map((doc) => {
      const match = docScores.get(doc.id)!;
      return {
        documentId: doc.id,
        path: doc.path,
        title: doc.title,
        url: doc.url,
        tags: doc.tags ? (JSON.parse(doc.tags) as string[]) : [],
        excerpt: match.excerpt,
        score: match.score,
        source: "keyword" as const,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Combined search: merge semantic + keyword results, deduplicate by document.
 */
export async function combinedSearch(
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  const [semanticOutcome, keywordOutcome] = await Promise.allSettled([
    semanticSearch(query, limit),
    Promise.resolve().then(() => keywordSearch(query, limit)),
  ]);

  const semanticResults =
    semanticOutcome.status === "fulfilled" ? semanticOutcome.value : [];
  const keywordResults =
    keywordOutcome.status === "fulfilled" ? keywordOutcome.value : [];

  if (semanticOutcome.status === "rejected") {
    console.error("[search] semantic failed:", semanticOutcome.reason);
  }
  if (keywordOutcome.status === "rejected") {
    console.error("[search] keyword failed:", keywordOutcome.reason);
  }

  // Merge, dedup by documentId, prefer semantic score
  const seen = new Map<number, SearchResult>();

  for (const r of semanticResults) {
    seen.set(r.documentId, r);
  }

  for (const r of keywordResults) {
    if (!seen.has(r.documentId)) {
      seen.set(r.documentId, r);
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get recently added documents. Uses source_date (frontmatter bookmarked/date)
 * when available, falls back to indexed_at.
 */
export function recentDocuments(days = 7, limit = 20) {
  const config = getConfig();
  const sqlite = getSqlite();

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return sqlite
    .prepare(
      `SELECT id, path, title, url, tags,
              COALESCE(source_date, indexed_at) as date,
              source_date as sourceDate,
              indexed_at as indexedAt
       FROM documents
       WHERE COALESCE(source_date, indexed_at) >= ?
       ORDER BY COALESCE(source_date, indexed_at) DESC
       LIMIT ?`,
    )
    .all(cutoff, limit) as Array<{
    id: number;
    path: string;
    title: string | null;
    url: string | null;
    tags: string | null;
    date: string;
    sourceDate: string | null;
    indexedAt: string;
  }>;
}

/**
 * Look up a document by URL or title.
 */
export function lookupDocument(opts: { url?: string; title?: string }) {
  const config = getConfig();
  const db = getDb(getDbPath(config));

  if (opts.url) {
    return db
      .select()
      .from(documents)
      .where(eq(documents.url, opts.url))
      .get();
  }

  if (opts.title) {
    // Use LIKE for partial matching
    const sqlite = getSqlite();
    const results = sqlite
      .prepare(
        "SELECT * FROM documents WHERE title LIKE ? LIMIT 5",
      )
      .all(`%${opts.title}%`);
    return results;
  }

  return null;
}
