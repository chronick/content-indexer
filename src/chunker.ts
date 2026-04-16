/**
 * Split markdown content into chunks of approximately targetSize characters.
 * Preserves paragraph boundaries where possible.
 */
export interface TextChunk {
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
}

const TARGET_CHUNK_SIZE = 2000; // ~500 tokens
const MIN_CHUNK_SIZE = 200;

export function chunkMarkdown(text: string): TextChunk[] {
  if (!text.trim()) return [];

  // Split on double newlines (paragraph boundaries)
  const paragraphs = text.split(/\n\n+/);
  const chunks: TextChunk[] = [];
  let currentChunk = "";
  let currentStart = 0;
  let offset = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const paraWithSep = i < paragraphs.length - 1 ? para + "\n\n" : para;

    if (
      currentChunk.length + paraWithSep.length > TARGET_CHUNK_SIZE &&
      currentChunk.length >= MIN_CHUNK_SIZE
    ) {
      // Flush current chunk
      chunks.push({
        content: currentChunk.trim(),
        index: chunks.length,
        startOffset: currentStart,
        endOffset: currentStart + currentChunk.length,
      });
      currentChunk = "";
      currentStart = offset;
    }

    currentChunk += paraWithSep;
    offset += paraWithSep.length;
  }

  // Flush remaining
  if (currentChunk.trim().length >= MIN_CHUNK_SIZE) {
    chunks.push({
      content: currentChunk.trim(),
      index: chunks.length,
      startOffset: currentStart,
      endOffset: currentStart + currentChunk.length,
    });
  } else if (chunks.length > 0 && currentChunk.trim()) {
    // Append to last chunk if too small
    const last = chunks[chunks.length - 1];
    last.content += "\n\n" + currentChunk.trim();
    last.endOffset = currentStart + currentChunk.length;
  } else if (currentChunk.trim()) {
    // Only chunk, even if small
    chunks.push({
      content: currentChunk.trim(),
      index: 0,
      startOffset: currentStart,
      endOffset: currentStart + currentChunk.length,
    });
  }

  return chunks;
}
