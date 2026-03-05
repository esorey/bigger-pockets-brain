/**
 * Unit tests for embedding service
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  createOpenAIEmbeddingService,
  OPENAI_PROVIDER,
  type EmbeddingService,
} from '../../src/embeddings/index.ts';

// Mock fetch for API calls
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// Helper to create a mock embedding response
function createMockResponse(embeddings: number[][]): Response {
  return new Response(
    JSON.stringify({
      data: embeddings.map((embedding, index) => ({ embedding, index })),
      usage: { prompt_tokens: 10, total_tokens: 10 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// Helper to calculate L2 norm
function l2Norm(vec: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i]! * vec[i]!;
  }
  return Math.sqrt(sum);
}

describe('EmbeddingService Interface', () => {
  afterEach(() => {
    restoreFetch();
  });

  test('embed() returns correct dimension vectors', async () => {
    const dims = 1536;
    mockFetch(async () => {
      return createMockResponse([Array(dims).fill(0.1)]);
    });

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
    });

    const results = await service.embed(['test text']);
    expect(results.length).toBe(1);
    expect(results[0]!.length).toBe(dims);
  });

  test('modelName property returns correct model', () => {
    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
    });

    expect(service.modelName).toBe('text-embedding-3-large');
  });

  test('dimensions property returns correct value', () => {
    const smallService = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
    });
    expect(smallService.dimensions).toBe(1536);

    const largeService = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
    });
    expect(largeService.dimensions).toBe(3072);
  });

  test('throws for unknown model', () => {
    expect(() => {
      createOpenAIEmbeddingService({
        apiKey: 'test-key',
        model: 'unknown-model',
      });
    }).toThrow(/Unknown OpenAI model/);
  });
});

describe('Vector Normalization', () => {
  afterEach(() => {
    restoreFetch();
  });

  test('output vectors are unit length (L2 norm = 1)', async () => {
    // Create non-normalized input
    const rawVector = [3, 4, 0]; // L2 norm = 5
    mockFetch(async () => createMockResponse([rawVector]));

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-ada-002', // 1536 dims but we mock with 3
    });

    // Mock dimensions check by using actual dimensions
    mockFetch(async () => createMockResponse([Array(1536).fill(0.1)]));
    const results = await service.embed(['test']);

    const norm = l2Norm(results[0]!);
    expect(Math.abs(norm - 1)).toBeLessThan(0.0001);
  });

  test('zero vector handling', async () => {
    mockFetch(async () => createMockResponse([Array(1536).fill(0)]));

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
    });

    const results = await service.embed(['test']);
    // Zero vector should stay zero (no NaN from division by 0)
    expect(results[0]!.every((v) => v === 0 || Number.isFinite(v))).toBe(true);
  });
});

describe('Batch Processing', () => {
  afterEach(() => {
    restoreFetch();
  });

  test('single text embedding', async () => {
    mockFetch(async () => createMockResponse([Array(1536).fill(0.1)]));

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
    });

    const results = await service.embed(['single text']);
    expect(results.length).toBe(1);
  });

  test('batch of 10 texts', async () => {
    mockFetch(async () => {
      return createMockResponse(Array(10).fill(Array(1536).fill(0.1)));
    });

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
    });

    const texts = Array(10).fill('test text');
    const results = await service.embed(texts);
    expect(results.length).toBe(10);
  });

  test('large batch is chunked appropriately', async () => {
    let callCount = 0;
    mockFetch(async (url, init) => {
      callCount++;
      const body = JSON.parse(init.body as string);
      const inputCount = body.input.length;
      return createMockResponse(Array(inputCount).fill(Array(1536).fill(0.1)));
    });

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      batchSize: 50, // Force chunking
      batchDelayMs: 0, // No delay for tests
    });

    const texts = Array(120).fill('test text');
    const results = await service.embed(texts);

    expect(results.length).toBe(120);
    expect(callCount).toBe(3); // 50 + 50 + 20
  });

  test('empty batch returns empty array', async () => {
    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
    });

    const results = await service.embed([]);
    expect(results.length).toBe(0);
  });
});

describe('Error Recovery', () => {
  afterEach(() => {
    restoreFetch();
  });

  test('rate limit (429) handled with backoff', async () => {
    let attempts = 0;
    mockFetch(async () => {
      attempts++;
      if (attempts < 3) {
        return new Response('Rate limited', { status: 429 });
      }
      return createMockResponse([Array(1536).fill(0.1)]);
    });

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      maxRetries: 5,
      retryBaseDelayMs: 10, // Short delay for tests
    });

    const results = await service.embed(['test']);
    expect(results.length).toBe(1);
    expect(attempts).toBe(3);
  });

  test('server error (500) triggers retry', async () => {
    let attempts = 0;
    mockFetch(async () => {
      attempts++;
      if (attempts < 2) {
        return new Response('Server error', { status: 500 });
      }
      return createMockResponse([Array(1536).fill(0.1)]);
    });

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    const results = await service.embed(['test']);
    expect(results.length).toBe(1);
    expect(attempts).toBe(2);
  });

  test('throws after max retries exceeded', async () => {
    mockFetch(async () => {
      return new Response('Rate limited', { status: 429 });
    });

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      maxRetries: 2,
      retryBaseDelayMs: 10,
    });

    await expect(service.embed(['test'])).rejects.toThrow();
  });

  test('non-retryable error throws immediately', async () => {
    let attempts = 0;
    mockFetch(async () => {
      attempts++;
      return new Response('Bad request', { status: 400 });
    });

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    await expect(service.embed(['test'])).rejects.toThrow(/400/);
    expect(attempts).toBe(1); // Only one attempt for non-retryable
  });
});

describe('Progress Callback', () => {
  afterEach(() => {
    restoreFetch();
  });

  test('progress callback receives correct counts', async () => {
    mockFetch(async (url, init) => {
      const body = JSON.parse(init.body as string);
      return createMockResponse(Array(body.input.length).fill(Array(1536).fill(0.1)));
    });

    const service = createOpenAIEmbeddingService({
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      batchSize: 3,
      batchDelayMs: 0,
    });

    const progressCalls: [number, number][] = [];
    await service.embedWithProgress(
      ['a', 'b', 'c', 'd', 'e'],
      (completed, total) => {
        progressCalls.push([completed, total]);
      }
    );

    expect(progressCalls).toEqual([
      [3, 5], // First batch of 3
      [5, 5], // Second batch of 2
    ]);
  });
});

describe('OPENAI_PROVIDER metadata', () => {
  test('contains expected models', () => {
    expect(OPENAI_PROVIDER.models.map((m) => m.id)).toContain('text-embedding-3-small');
    expect(OPENAI_PROVIDER.models.map((m) => m.id)).toContain('text-embedding-3-large');
  });

  test('models have correct dimensions', () => {
    const small = OPENAI_PROVIDER.models.find((m) => m.id === 'text-embedding-3-small');
    expect(small?.dimensions).toBe(1536);

    const large = OPENAI_PROVIDER.models.find((m) => m.id === 'text-embedding-3-large');
    expect(large?.dimensions).toBe(3072);
  });
});
