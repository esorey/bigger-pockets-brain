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

/** Word boundary pattern */
const WORD_BOUNDARY = /\s+/g;

/**
 * Find word boundaries in text
 * Returns array of { start, end } for each word
 */
function findWordBoundaries(text: string): { start: number; end: number }[] {
  const boundaries: { start: number; end: number }[] = [];
  const words = text.split(WORD_BOUNDARY);
  let pos = 0;

  for (const word of words) {
    if (word.length === 0) continue;

    // Find actual position of word (accounting for whitespace)
    const wordStart = text.indexOf(word, pos);
    if (wordStart === -1) continue;

    boundaries.push({
      start: wordStart,
      end: wordStart + word.length,
    });
    pos = wordStart + word.length;
  }

  return boundaries;
}

/**
 * Find sentence boundaries in text
 * Returns array of character positions where sentences end
 */
function findSentenceBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  let match;

  SENTENCE_END.lastIndex = 0;
  while ((match = SENTENCE_END.exec(text)) !== null) {
    boundaries.push(match.index + match[0].length);
  }

  return boundaries;
}

/**
 * Find the best split point near a target position
 * Prefers sentence boundaries, falls back to word boundaries
 */
function findBestSplitPoint(
  text: string,
  targetPos: number,
  sentenceBoundaries: number[],
  wordBoundaries: { start: number; end: number }[]
): number {
  // Look for sentence boundary within 20% of target
  const tolerance = Math.round(targetPos * 0.2);
  const minPos = Math.max(0, targetPos - tolerance);
  const maxPos = Math.min(text.length, targetPos + tolerance);

  // Find closest sentence boundary in range
  let closestSentence = -1;
  let closestDistance = Infinity;

  for (const boundary of sentenceBoundaries) {
    if (boundary >= minPos && boundary <= maxPos) {
      const distance = Math.abs(boundary - targetPos);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestSentence = boundary;
      }
    }
  }

  if (closestSentence !== -1) {
    return closestSentence;
  }

  // Fall back to word boundary
  for (const word of wordBoundaries) {
    if (word.end >= minPos && word.end <= maxPos) {
      // Return position after the word (include trailing space)
      const afterWord = word.end;
      const nextChar = text[afterWord];
      if (nextChar && /\s/.test(nextChar)) {
        return afterWord + 1;
      }
      return afterWord;
    }
  }

  // Last resort: return target position
  return Math.min(targetPos, text.length);
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text.split(WORD_BOUNDARY).filter((w) => w.length > 0).length;
}

/**
 * Get character position after N words from start
 */
function getPositionAfterWords(
  wordBoundaries: { start: number; end: number }[],
  wordCount: number
): number {
  if (wordCount >= wordBoundaries.length) {
    const last = wordBoundaries[wordBoundaries.length - 1];
    return last ? last.end : 0;
  }
  const word = wordBoundaries[wordCount];
  return word ? word.start : 0;
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

  // Handle empty or very short text
  const totalWords = countWords(text);
  if (totalWords === 0) {
    return [];
  }

  if (totalWords <= targetWords) {
    // Single chunk for short transcripts
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

  const chunks: Omit<Chunk, 'id'>[] = [];
  const wordBoundaries = findWordBoundaries(text);
  const sentenceBoundaries = findSentenceBoundaries(text);

  let chunkIndex = 0;
  let startWordIndex = 0;

  while (startWordIndex < wordBoundaries.length) {
    // Calculate target end position
    const endWordIndex = Math.min(
      startWordIndex + targetWords,
      wordBoundaries.length
    );

    // Get character positions
    const startChar =
      chunkIndex === 0
        ? 0
        : wordBoundaries[startWordIndex]?.start ?? 0;

    const targetEndChar = getPositionAfterWords(wordBoundaries, endWordIndex);

    // Find best split point
    let endChar: number;
    if (endWordIndex >= wordBoundaries.length) {
      // Last chunk - go to end
      endChar = text.length;
    } else {
      endChar = findBestSplitPoint(
        text,
        targetEndChar,
        sentenceBoundaries,
        wordBoundaries
      );
    }

    // Extract chunk text
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

    // Move start position (accounting for overlap)
    const wordsInChunk = countWords(chunkText);
    const advanceWords = Math.max(1, wordsInChunk - overlapWords);
    startWordIndex += advanceWords;

    // Safety check to prevent infinite loop
    if (startWordIndex >= wordBoundaries.length) {
      break;
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
