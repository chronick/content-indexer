import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getConfig, getDbPath } from "../config.js";
import { getDb } from "../db/connection.js";
import { combinedSearch, lookupDocument } from "../search.js";
import { getStats } from "../indexer.js";

export function createMcpServer() {
  const server = new McpServer({
    name: "content-search",
    version: "1.0.0",
  });

  server.tool(
    "search_content",
    "Search indexed content (bookmarks, articles, documents) by semantic similarity and keyword matching. Returns matching excerpts with titles, URLs, tags, and relevance scores.",
    {
      query: z.string().describe("Natural language search query"),
      limit: z
        .number()
        .optional()
        .describe("Max results to return (default 5)"),
    },
    async ({ query, limit }) => {
      try {
        const results = await combinedSearch(query, limit || 5);
        if (results.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No results found for that query." },
            ],
          };
        }

        const formatted = results
          .map((r) => {
            const lines = [
              `**${r.title || r.path}** (score: ${r.score.toFixed(3)})`,
            ];
            if (r.url) lines.push(`URL: ${r.url}`);
            if (r.tags.length) lines.push(`Tags: ${r.tags.join(", ")}`);
            lines.push(`\n${r.excerpt.slice(0, 300)}...`);
            return lines.join("\n");
          })
          .join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text: formatted }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "content_stats",
    "Get statistics about the content index — total documents, chunks, embeddings count, and top tags.",
    {},
    async () => {
      try {
        const stats = getStats();
        const text = [
          `Documents: ${stats.documents}`,
          `Chunks: ${stats.chunks}`,
          `Embeddings: ${stats.embeddings}`,
          "",
          "Top tags:",
          ...stats.topTags
            .slice(0, 15)
            .map((t) => `  ${t.tag}: ${t.count}`),
        ].join("\n");

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "lookup_content",
    "Look up a specific document by URL or title. Returns full metadata.",
    {
      url: z.string().optional().describe("Exact URL to look up"),
      title: z.string().optional().describe("Partial title to search for"),
    },
    async ({ url, title }) => {
      if (!url && !title) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Provide either 'url' or 'title' to look up a document.",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = lookupDocument({ url, title });
        if (!result || (Array.isArray(result) && result.length === 0)) {
          return {
            content: [{ type: "text" as const, text: "No matching document found." }],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

/**
 * Run the MCP server over stdio (for CLI / Claude Code integration).
 */
export async function runMcpStdio() {
  const config = getConfig();
  getDb(getDbPath(config));

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
