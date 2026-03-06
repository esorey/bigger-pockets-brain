/**
 * Transcript chunker for granular embedding
 *
 * Splits transcripts into ~500 word chunks with ~50 word overlap,
 * preferring sentence boundaries when possible.
 */

import type { Chunk } from '../types';

/** Chunking configuration */
export interface ChunkOptions {
  /** Target words per chunk (default: 500) */
  targetWords?: number;

  /** Words to overlap between chunks (default: 50) */
  overlapWords?: number;
}

const DEFAULT_TARGET_WORDS = 500;
const DEFAULT_OVERLAP_WORDS = 50;

/** Sentence-ending punctuation pattern */
const SENTENCE_END = /[.!?]["'»]?\s+/g;

/**
 * Split text into words with their positions
 */
function tokenize(text: string): { word: string; start: number; end: number }[] {
  const tokens: { word: string; start: number; end: number }[] = [];
  const regex = /\S+/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

/**
 * Find sentence boundaries in text
 */
function findSentenceEnds(text: string): Set<number> {
  const ends = new Set<number>();
  let match;

  SENTENCE_END.lastIndex = 0;
  while ((match = SENTENCE_END.exec(text)) !== null) {
    ends.add(match.index + match[0].length);
  }

  return ends;
}

/**
 * Find the best end position for a chunk
 * Prefers sentence boundaries within 20% of target
 */
function findChunkEnd(
  tokens: { word: string; start: number; end: number }[],
  startToken: number,
  targetWords: number,
  sentenceEnds: Set<number>,
  textLength: number
): { endToken: number; endChar: number } {
  const endToken = Math.min(startToken + targetWords, tokens.length);

  if (endToken >= tokens.length) {
    return { endToken: tokens.length, endChar: textLength };
  }

  const targetChar = tokens[endToken - 1]?.end ?? textLength;
  const tolerance = Math.round(targetWords * 0.2);

  // Find tokens in tolerance range
  const minToken = Math.max(startToken + 1, endToken - tolerance);
  const maxToken = Math.min(tokens.length, endToken + tolerance);

  // Look for sentence boundary in range
  for (let i = minToken; i < maxToken; i++) {
    const tokenEnd = tokens[i]?.end;
    if (tokenEnd && sentenceEnds.has(tokenEnd)) {
      // Found sentence boundary - check if there's whitespace after
      return { endToken: i + 1, endChar: tokenEnd };
    }
  }

  // No sentence boundary - use word boundary
  return { endToken, endChar: targetChar };
}

/**
 * Chunk a transcript into overlapping segments
 *
 * @param text Transcript text to chunk
 * @param episodeNumber Episode number for metadata
 * @param options Chunking configuration
 * @returns Array of chunks with position metadata
 */
export function chunkTranscript(
  text: string,
  episodeNumber: number,
  options: ChunkOptions = {}
): Omit<Chunk, 'id'>[] {
  const targetWords = options.targetWords ?? DEFAULT_TARGET_WORDS;
  const overlapWords = options.overlapWords ?? DEFAULT_OVERLAP_WORDS;

  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return [];
  }

  if (tokens.length <= targetWords) {
    return [
      {
        episodeNumber,
        chunkIndex: 0,
        chunkText: text.trim(),
        startChar: 0,
        endChar: text.length,
      },
    ];
  }

  const sentenceEnds = findSentenceEnds(text);
  const chunks: Omit<Chunk, 'id'>[] = [];
  const stepWords = targetWords - overlapWords;

  let chunkIndex = 0;
  let startToken = 0;

  while (startToken < tokens.length) {
    const startChar = tokens[startToken]?.start ?? 0;

    const { endToken, endChar } = findChunkEnd(
      tokens,
      startToken,
      targetWords,
      sentenceEnds,
      text.length
    );

    const chunkText = text.slice(startChar, endChar).trim();

    if (chunkText.length > 0) {
      chunks.push({
        episodeNumber,
        chunkIndex,
        chunkText,
        startChar,
        endChar,
      });
      chunkIndex++;
    }

    // Advance by step (targetWords - overlapWords) for overlap
    startToken += stepWords;

    // If we're near the end, make sure we don't skip the last part
    if (startToken < tokens.length && startToken + targetWords >= tokens.length) {
      // Position for final chunk that captures everything remaining
      if (endToken >= tokens.length) {
        break; // Already captured everything
      }
    }
  }

  return chunks;
}

/**
 * Chunk multiple transcripts
 *
 * @param episodes Array of { episodeNumber, transcriptText }
 * @param options Chunking configuration
 * @returns Map of episodeNumber -> chunks
 */
export function chunkTranscripts(
  episodes: { episodeNumber: number; transcriptText: string }[],
  options: ChunkOptions = {}
): Map<number, Omit<Chunk, 'id'>[]> {
  const result = new Map<number, Omit<Chunk, 'id'>[]>();

  for (const episode of episodes) {
    const chunks = chunkTranscript(
      episode.transcriptText,
      episode.episodeNumber,
      options
    );
    result.set(episode.episodeNumber, chunks);
  }

  return result;
}
