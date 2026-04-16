import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(), // relative to content dir
  title: text("title"),
  url: text("url"),
  tags: text("tags"), // JSON array
  sourceDate: text("source_date"), // from frontmatter (e.g. bookmarked date)
  contentHash: text("content_hash").notNull(), // SHA-256
  chunkCount: integer("chunk_count").notNull().default(0),
  indexedAt: text("indexed_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const chunks = sqliteTable("chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
});

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
