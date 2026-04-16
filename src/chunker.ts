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
const MAX_CHUNK_SIZE = 5000; // hard limit to stay under embedding context
const MIN_CHUNK_SIZE = 200;

/** Split a long text on single newlines or sentence boundaries */
function hardSplit(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text];

  const pieces: string[] = [];
  let remaining = text;
  while (remaining.length > maxSize) {
    // Try to split on newline
    let splitAt = remaining.lastIndexOf("\n", maxSize);
    if (splitAt < maxSize / 2) {
      // Try sentence boundary
      splitAt = remaining.lastIndexOf(". ", maxSize);
      if (splitAt < maxSize / 2) {
        // Hard split at maxSize
        splitAt = maxSize;
      } else {
        splitAt += 2; // include ". "
      }
    }
    pieces.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

export function chunkMarkdown(text: string): TextChunk[] {
  if (!text.trim()) return [];

  // Split on double newlines (paragraph boundaries), then hard-split oversized paragraphs
  const rawParagraphs = text.split(/\n\n+/);
  const paragraphs: string[] = [];
  for (const p of rawParagraphs) {
    if (p.length > MAX_CHUNK_SIZE) {
      paragraphs.push(...hardSplit(p, TARGET_CHUNK_SIZE));
    } else {
      paragraphs.push(p);
    }
  }
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
