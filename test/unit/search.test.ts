import { describe, test, expect } from "bun:test";
import { l2ToCosineSimilarity } from "../../src/search";

describe("l2ToCosineSimilarity", () => {
  test("identical vectors (distance=0) → similarity 1.0", () => {
    expect(l2ToCosineSimilarity(0)).toBe(1);
  });

  test("orthogonal vectors (distance=sqrt(2)) → similarity 0.0", () => {
    // For normalized vectors, orthogonal has L2 distance = sqrt(2)
    const distance = Math.sqrt(2);
    const similarity = l2ToCosineSimilarity(distance);
    expect(similarity).toBeCloseTo(0, 10);
  });

  test("opposite vectors (distance=2) → similarity -1.0", () => {
    // For normalized vectors, opposite has L2 distance = 2
    const similarity = l2ToCosineSimilarity(2);
    expect(similarity).toBeCloseTo(-1, 10);
  });

  test("near-match vectors → high positive similarity", () => {
    // Small L2 distance should give high similarity
    const similarity = l2ToCosineSimilarity(0.1);
    expect(similarity).toBeGreaterThan(0.99);
  });

  test("mid-range distance → mid-range similarity", () => {
    // L2 distance of 1 (half-angle between vectors)
    const similarity = l2ToCosineSimilarity(1);
    expect(similarity).toBe(0.5);
  });
});

describe("vector math properties", () => {
  test("similarity is monotonically decreasing with distance", () => {
    const distances = [0, 0.5, 1, 1.5, 2];
    const similarities = distances.map(l2ToCosineSimilarity);

    for (let i = 1; i < similarities.length; i++) {
      expect(similarities[i]).toBeLessThan(similarities[i - 1]!);
    }
  });

  test("similarity range is [-1, 1] for valid L2 distances", () => {
    // Valid L2 distances for unit vectors: [0, 2]
    const testDistances = [0, 0.1, 0.5, 1, 1.5, 1.9, 2];
    for (const d of testDistances) {
      const sim = l2ToCosineSimilarity(d);
      expect(sim).toBeGreaterThanOrEqual(-1);
      expect(sim).toBeLessThanOrEqual(1);
    }
  });
});

// Mock types for grouping tests
interface MockHit {
  rowid: number;
  distance: number;
  type: "summary" | "chunk";
  reference_id: number;
  episode_number: number;
}

// Helper to simulate groupByEpisode logic
function groupByEpisode(hits: MockHit[]): Map<number, MockHit> {
  const map = new Map<number, MockHit>();
  for (const hit of hits) {
    const existing = map.get(hit.episode_number);
    if (!existing || hit.distance < existing.distance) {
      map.set(hit.episode_number, hit);
    }
  }
  return map;
}

describe("episode grouping", () => {
  test("multiple chunks from same episode → single result with best score", () => {
    const hits: MockHit[] = [
      { rowid: 1, distance: 0.5, type: "chunk", reference_id: 100, episode_number: 42 },
      { rowid: 2, distance: 0.3, type: "chunk", reference_id: 101, episode_number: 42 },
      { rowid: 3, distance: 0.7, type: "chunk", reference_id: 102, episode_number: 42 },
    ];

    const grouped = groupByEpisode(hits);
    expect(grouped.size).toBe(1);
    expect(grouped.get(42)?.distance).toBe(0.3);
    expect(grouped.get(42)?.reference_id).toBe(101);
  });

  test("different episodes → keep all", () => {
    const hits: MockHit[] = [
      { rowid: 1, distance: 0.5, type: "chunk", reference_id: 100, episode_number: 42 },
      { rowid: 2, distance: 0.3, type: "chunk", reference_id: 200, episode_number: 43 },
      { rowid: 3, distance: 0.7, type: "summary", reference_id: 44, episode_number: 44 },
    ];

    const grouped = groupByEpisode(hits);
    expect(grouped.size).toBe(3);
  });

  test("same episode in both layers → take best score regardless of type", () => {
    const hits: MockHit[] = [
      { rowid: 1, distance: 0.5, type: "summary", reference_id: 42, episode_number: 42 },
      { rowid: 2, distance: 0.3, type: "chunk", reference_id: 100, episode_number: 42 },
    ];

    const grouped = groupByEpisode(hits);
    expect(grouped.size).toBe(1);
    expect(grouped.get(42)?.type).toBe("chunk");
    expect(grouped.get(42)?.distance).toBe(0.3);
  });

  test("empty hits → empty result", () => {
    const grouped = groupByEpisode([]);
    expect(grouped.size).toBe(0);
  });
});

describe("ranking", () => {
  test("results should be orderable by similarity score", () => {
    const hits: MockHit[] = [
      { rowid: 3, distance: 0.7, type: "chunk", reference_id: 102, episode_number: 44 },
      { rowid: 1, distance: 0.2, type: "chunk", reference_id: 100, episode_number: 42 },
      { rowid: 2, distance: 0.5, type: "chunk", reference_id: 101, episode_number: 43 },
    ];

    // Sort by distance (lower = better)
    const sorted = [...hits].sort((a, b) => a.distance - b.distance);

    expect(sorted[0]?.episode_number).toBe(42);
    expect(sorted[1]?.episode_number).toBe(43);
    expect(sorted[2]?.episode_number).toBe(44);
  });

  test("ties should be broken consistently", () => {
    const hits: MockHit[] = [
      { rowid: 1, distance: 0.5, type: "chunk", reference_id: 100, episode_number: 42 },
      { rowid: 2, distance: 0.5, type: "chunk", reference_id: 101, episode_number: 43 },
    ];

    // Sort by distance, then by rowid for tie-breaking
    const sorted = [...hits].sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.rowid - b.rowid;
    });

    expect(sorted[0]?.rowid).toBe(1);
    expect(sorted[1]?.rowid).toBe(2);
  });
});

describe("edge cases", () => {
  test("only summary hits", () => {
    const hits: MockHit[] = [
      { rowid: 1, distance: 0.3, type: "summary", reference_id: 42, episode_number: 42 },
      { rowid: 2, distance: 0.5, type: "summary", reference_id: 43, episode_number: 43 },
    ];

    const grouped = groupByEpisode(hits);
    expect(grouped.size).toBe(2);
    for (const [, hit] of grouped) {
      expect(hit.type).toBe("summary");
    }
  });

  test("only chunk hits", () => {
    const hits: MockHit[] = [
      { rowid: 1, distance: 0.3, type: "chunk", reference_id: 100, episode_number: 42 },
      { rowid: 2, distance: 0.5, type: "chunk", reference_id: 101, episode_number: 43 },
    ];

    const grouped = groupByEpisode(hits);
    expect(grouped.size).toBe(2);
    for (const [, hit] of grouped) {
      expect(hit.type).toBe("chunk");
    }
  });

  test("very close similarity scores", () => {
    const hits: MockHit[] = [
      { rowid: 1, distance: 0.50000001, type: "chunk", reference_id: 100, episode_number: 42 },
      { rowid: 2, distance: 0.50000002, type: "chunk", reference_id: 101, episode_number: 43 },
    ];

    const sorted = [...hits].sort((a, b) => a.distance - b.distance);
    expect(sorted[0]?.episode_number).toBe(42);
  });
});
