/**
 * Unit tests for transcript chunker
 */

import { describe, test, expect } from 'bun:test';
import { chunkTranscript, chunkTranscripts } from '../../src/processing/chunker.ts';

// Helper to generate text with N words
function generateWords(n: number): string {
  const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog'];
  const result: string[] = [];
  for (let i = 0; i < n; i++) {
    result.push(words[i % words.length]!);
  }
  return result.join(' ');
}

// Helper to count words in text
function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

describe('Word Counting', () => {
  test('chunks are approximately 500 words (except last)', () => {
    const text = generateWords(1500);
    const chunks = chunkTranscript(text, 1);

    // All chunks except the last should be close to target
    for (let i = 0; i < chunks.length - 1; i++) {
      const wordCount = countWords(chunks[i]!.chunkText);
      // Allow 30% variance due to sentence boundary seeking
      expect(wordCount).toBeGreaterThan(300);
      expect(wordCount).toBeLessThan(700);
    }

    // Last chunk can be any size (leftover)
    const lastChunk = chunks[chunks.length - 1]!;
    expect(countWords(lastChunk.chunkText)).toBeGreaterThan(0);
  });

  test('handles hyphenated words', () => {
    const text = 'state-of-the-art self-employed twenty-one real-estate-focused';
    const chunks = chunkTranscript(text, 1);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkText).toBe(text);
  });

  test('handles contractions', () => {
    const text = "I'm don't can't won't shouldn't";
    const chunks = chunkTranscript(text, 1);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkText).toBe(text);
  });

  test('handles numbers and dates', () => {
    const text = 'On 2024-03-15, we had $47,000 in revenue with 3.5% growth';
    const chunks = chunkTranscript(text, 1);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkText).toBe(text);
  });
});

describe('Overlap', () => {
  test('chunks have approximately 50 word overlap', () => {
    const text = generateWords(1200);
    const chunks = chunkTranscript(text, 1, { targetWords: 500, overlapWords: 50 });

    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Check overlap between consecutive chunks
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1]!;
      const currChunk = chunks[i]!;

      // Current chunk should start before previous chunk ends
      // (indicating overlap in the original text)
      expect(currChunk.startChar).toBeLessThan(prevChunk.endChar);
    }
  });

  test('first chunk starts at beginning', () => {
    const text = generateWords(1200);
    const chunks = chunkTranscript(text, 1);

    expect(chunks[0]!.startChar).toBe(0);
  });

  test('last chunk ends at text end', () => {
    const text = generateWords(1200);
    const chunks = chunkTranscript(text, 1);

    const lastChunk = chunks[chunks.length - 1]!;
    expect(lastChunk.endChar).toBe(text.length);
  });
});

describe('Offset Tracking', () => {
  test('start_char points to first char of chunk', () => {
    const text = 'First sentence here. Second sentence follows. Third one too.';
    const chunks = chunkTranscript(text, 1, { targetWords: 3, overlapWords: 1 });

    for (const chunk of chunks) {
      const extracted = text.slice(chunk.startChar, chunk.endChar).trim();
      expect(extracted).toBe(chunk.chunkText);
    }
  });

  test('offsets align with actual transcript positions', () => {
    const text = generateWords(200);
    const chunks = chunkTranscript(text, 1, { targetWords: 50, overlapWords: 10 });

    for (const chunk of chunks) {
      expect(chunk.startChar).toBeGreaterThanOrEqual(0);
      expect(chunk.endChar).toBeLessThanOrEqual(text.length);
      expect(chunk.startChar).toBeLessThan(chunk.endChar);
    }
  });

  test('chunk indices are sequential', () => {
    const text = generateWords(1500);
    const chunks = chunkTranscript(text, 1);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
    }
  });

  test('all chunks have correct episode number', () => {
    const text = generateWords(1500);
    const episodeNumber = 42;
    const chunks = chunkTranscript(text, episodeNumber);

    for (const chunk of chunks) {
      expect(chunk.episodeNumber).toBe(episodeNumber);
    }
  });
});

describe('Edge Cases', () => {
  test('empty transcript returns 0 chunks', () => {
    const chunks = chunkTranscript('', 1);
    expect(chunks.length).toBe(0);
  });

  test('whitespace-only transcript returns 0 chunks', () => {
    const chunks = chunkTranscript('   \n\t  ', 1);
    expect(chunks.length).toBe(0);
  });

  test('very short transcript (<500 words) returns 1 chunk', () => {
    const text = generateWords(100);
    const chunks = chunkTranscript(text, 1);

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkText.trim()).toBe(text);
  });

  test('exactly 500 words returns 1 chunk', () => {
    const text = generateWords(500);
    const chunks = chunkTranscript(text, 1);

    expect(chunks.length).toBe(1);
  });

  test('single word returns 1 chunk', () => {
    const chunks = chunkTranscript('hello', 1);

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkText).toBe('hello');
    expect(chunks[0]!.startChar).toBe(0);
    expect(chunks[0]!.endChar).toBe(5);
  });

  test('very long transcript (>50k words) produces many chunks', () => {
    const text = generateWords(60000);
    const chunks = chunkTranscript(text, 1);

    // Should have roughly 60000 / (500 - 50) = ~133 chunks
    expect(chunks.length).toBeGreaterThan(100);

    // All chunks should have valid offsets
    for (const chunk of chunks) {
      expect(chunk.startChar).toBeGreaterThanOrEqual(0);
      expect(chunk.endChar).toBeLessThanOrEqual(text.length);
    }
  });
});

describe('Boundary Handling', () => {
  test('prefers sentence boundaries when possible', () => {
    // Create sentences that will require splitting
    const sentences = Array(10)
      .fill(null)
      .map(() => generateWords(100) + '.')
      .join(' ');

    const chunks = chunkTranscript(sentences, 1, { targetWords: 250, overlapWords: 25 });

    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // At least some chunks should end with a period (sentence boundary)
    const chunksEndingWithPeriod = chunks.filter((c) =>
      c.chunkText.trim().endsWith('.')
    );
    expect(chunksEndingWithPeriod.length).toBeGreaterThan(0);
  });

  test('falls back to word boundaries when no sentences', () => {
    // Text without sentence-ending punctuation
    const text = generateWords(1200);
    const chunks = chunkTranscript(text, 1);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Each chunk should end on a word boundary (no partial words)
    for (const chunk of chunks) {
      const lastChar = chunk.chunkText[chunk.chunkText.length - 1];
      expect(lastChar).not.toMatch(/\s/);
    }
  });

  test('handles text with no periods (bullet points)', () => {
    const bullets = Array(100).fill('• Item description here').join('\n');
    const chunks = chunkTranscript(bullets, 1);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Should not crash and should produce valid chunks
    for (const chunk of chunks) {
      expect(chunk.chunkText.length).toBeGreaterThan(0);
    }
  });
});

describe('chunkTranscripts (batch)', () => {
  test('processes multiple episodes', () => {
    const episodes = [
      { episodeNumber: 1, transcriptText: generateWords(600) },
      { episodeNumber: 2, transcriptText: generateWords(800) },
      { episodeNumber: 3, transcriptText: generateWords(400) },
    ];

    const results = chunkTranscripts(episodes);

    expect(results.size).toBe(3);
    expect(results.get(1)!.length).toBeGreaterThanOrEqual(1);
    expect(results.get(2)!.length).toBeGreaterThanOrEqual(1);
    expect(results.get(3)!.length).toBe(1); // 400 words = single chunk
  });

  test('each episode has correct episode number on chunks', () => {
    const episodes = [
      { episodeNumber: 42, transcriptText: generateWords(600) },
      { episodeNumber: 99, transcriptText: generateWords(600) },
    ];

    const results = chunkTranscripts(episodes);

    for (const chunk of results.get(42)!) {
      expect(chunk.episodeNumber).toBe(42);
    }
    for (const chunk of results.get(99)!) {
      expect(chunk.episodeNumber).toBe(99);
    }
  });
});
