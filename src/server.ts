import Fastify from "fastify";
import cors from "@fastify/cors";
import { combinedSearch, semanticSearch, keywordSearch } from "./search.js";
import { rebuild, getStats } from "./indexer.js";
import { indexFile } from "./indexer.js";
import { lookupDocument } from "./search.js";
import { getConfig } from "./config.js";
import path from "path";

export async function createServer() {
  const app = Fastify({ logger: false });
  await app.register(cors);

  app.get("/health", async () => {
    const stats = getStats();
    return {
      status: "ok",
      documents: stats.documents,
      chunks: stats.chunks,
    };
  });

  app.get("/stats", async () => {
    return getStats();
  });

  app.get<{ Querystring: { q: string; limit?: string } }>(
    "/search",
    async (req) => {
      const { q, limit } = req.query;
      if (!q) return { results: [], error: "Missing query parameter 'q'" };
      const results = await combinedSearch(q, Number(limit) || 10);
      return { results };
    },
  );

  app.get<{ Querystring: { q: string; limit?: string } }>(
    "/search/semantic",
    async (req) => {
      const { q, limit } = req.query;
      if (!q) return { results: [], error: "Missing query parameter 'q'" };
      const results = await semanticSearch(q, Number(limit) || 10);
      return { results };
    },
  );

  app.get<{ Querystring: { q: string; limit?: string } }>(
    "/search/keyword",
    async (req) => {
      const { q, limit } = req.query;
      if (!q) return { results: [], error: "Missing query parameter 'q'" };
      const results = keywordSearch(q, Number(limit) || 10);
      return { results };
    },
  );

  app.post("/reindex", async () => {
    const result = await rebuild();
    return result;
  });

  app.post<{ Params: { "*": string } }>("/reindex/*", async (req) => {
    const filePath = req.params["*"];
    const config = getConfig();
    const fullPath = path.join(config.CONTENT_DIR, filePath);
    const indexed = await indexFile(fullPath);
    return { indexed, path: filePath };
  });

  app.get<{ Querystring: { url?: string; title?: string } }>(
    "/lookup",
    async (req) => {
      const { url, title } = req.query;
      if (!url && !title)
        return { error: "Provide 'url' or 'title' parameter" };
      const result = lookupDocument({ url, title });
      return { result };
    },
  );

  return app;
}
