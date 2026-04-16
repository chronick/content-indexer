import path from "path";
import { z } from "zod";

const envSchema = z.object({
  CONTENT_DIR: z.string().default(
    path.join(process.env.HOME || "~", "rig/data/bookmarks/content"),
  ),
  DATA_DIR: z.string().default(
    path.join(process.env.HOME || "~", "rig/data/content-index"),
  ),
  OLLAMA_HOST: z.string().default("http://localhost:11434"),
  EMBED_MODEL: z.string().default("nomic-embed-text"),
  PORT: z.coerce.number().default(7800),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = envSchema.parse(process.env);
  }
  return _config;
}

export function getDbPath(config: Config): string {
  return path.join(config.DATA_DIR, "index.db");
}
