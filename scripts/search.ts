/**
 * Semantic search script - finds relevant podcast episodes
 *
 * Usage: bun run scripts/search.ts "your query here"
 */

import {
  initializeDatabase,
  EpisodeRepository,
  ChunkRepository,
  EmbeddingRepository,
} from "../src/db";
import { TextEmbedder, findTopK } from "../src/processing";

const TOP_K = 5;

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: bun run scripts/search.ts \"your query\"");
    process.exit(1);
  }

  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) {
    console.error("[SEARCH] EMBEDDING_API_KEY not set");
    process.exit(1);
  }

  const { db } = initializeDatabase({ dbPath: "./data/biggerpockets.db" });
  const episodeRepo = new EpisodeRepository(db);
  const chunkRepo = new ChunkRepository(db);
  const embeddingRepo = new EmbeddingRepository(db);
  const embedder = new TextEmbedder(apiKey);

  console.log(`[SEARCH] Query: "${query}"`);
  console.log("[SEARCH] Embedding query...");

  // Embed the query
  const { embedding: queryVector } = await embedder.embed(query);

  // Get all chunk embeddings
  const allEmbeddings = embeddingRepo.getEmbeddingsByType("chunk");
  console.log(`[SEARCH] Searching ${allEmbeddings.length} chunks...`);

  if (allEmbeddings.length === 0) {
    console.log("[SEARCH] No embeddings found. Run 'bun run scripts/embed.ts' first.");
    db.close();
    return;
  }

  // Find top-k matches
  const vectors = allEmbeddings.map((e) => ({ id: e.referenceId, vector: e.vector }));
  const topMatches = findTopK(queryVector, vectors, TOP_K);

  console.log(`\n[SEARCH] Top ${TOP_K} results:\n`);

  for (let i = 0; i < topMatches.length; i++) {
    const match = topMatches[i];
    const chunk = chunkRepo.getChunk(match.id);

    if (!chunk) continue;

    const episode = episodeRepo.getEpisode(chunk.episodeNumber);
    if (!episode) continue;

    console.log(`${i + 1}. Episode ${episode.episodeNumber}: ${episode.title}`);
    console.log(`   Similarity: ${(match.similarity * 100).toFixed(1)}%`);
    console.log(`   URL: ${episode.url}`);
    console.log(`   Snippet: "${chunk.chunkText.slice(0, 200)}..."`);
    console.log();
  }

  db.close();
}

main().catch((err) => {
  console.error("[SEARCH] Error:", err.message);
  process.exit(1);
});
