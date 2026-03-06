/**
 * Embedding script - chunks transcripts and generates embeddings
 *
 * 1. Chunks all fetched transcripts
 * 2. Embeds each chunk using OpenAI text-embedding-3-small
 * 3. Stores embeddings in SQLite for search
 */

import {
  initializeDatabase,
  EpisodeRepository,
  ChunkRepository,
  EmbeddingRepository,
} from "../src/db";
import { chunkTranscript, TextEmbedder } from "../src/processing";

const BATCH_SIZE = 50; // Embed 50 chunks at a time
const DELAY_MS = 100; // Small delay between batches to avoid rate limits

async function main() {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) {
    console.error("[EMBED] EMBEDDING_API_KEY not set");
    process.exit(1);
  }

  const { db } = initializeDatabase({ dbPath: "./data/biggerpockets.db" });
  const episodeRepo = new EpisodeRepository(db);
  const chunkRepo = new ChunkRepository(db);
  const embeddingRepo = new EmbeddingRepository(db);
  const embedder = new TextEmbedder(apiKey);

  // Get all fetched episodes
  const episodes = episodeRepo.getEpisodesByStatus("fetched");
  console.log(`[EMBED] Found ${episodes.length} episodes to process`);

  // Check what's already embedded
  const existingCount = embeddingRepo.count();
  console.log(`[EMBED] ${existingCount} embeddings already in database`);

  let totalChunks = 0;
  let totalEmbedded = 0;
  let totalTokens = 0;

  for (const episode of episodes) {
    if (!episode.transcriptText) continue;

    // Check if already chunked
    let chunks = chunkRepo.getChunksForEpisode(episode.episodeNumber);

    if (chunks.length === 0) {
      // Chunk the transcript
      const newChunks = chunkTranscript(
        episode.transcriptText,
        episode.episodeNumber
      );
      chunkRepo.saveChunks(episode.episodeNumber, newChunks);
      chunks = chunkRepo.getChunksForEpisode(episode.episodeNumber);
      console.log(`[EMBED] Chunked episode ${episode.episodeNumber}: ${chunks.length} chunks`);
    }

    totalChunks += chunks.length;

    // Check which chunks need embedding
    const existingEmbeddings = embeddingRepo.getEmbeddingsForEpisode(episode.episodeNumber);
    const embeddedChunkIds = new Set(
      existingEmbeddings
        .filter((e) => e.type === "chunk")
        .map((e) => e.referenceId)
    );

    const chunksToEmbed = chunks.filter((c) => !embeddedChunkIds.has(c.id));

    if (chunksToEmbed.length === 0) {
      continue; // All chunks already embedded
    }

    // Embed in batches
    for (let i = 0; i < chunksToEmbed.length; i += BATCH_SIZE) {
      const batch = chunksToEmbed.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.chunkText);

      try {
        const { embeddings, totalTokens: batchTokens } = await embedder.embedBatch(texts);

        // Save embeddings
        const toSave = batch.map((chunk, idx) => ({
          referenceId: chunk.id,
          type: "chunk" as const,
          episodeNumber: episode.episodeNumber,
          vector: embeddings[idx],
        }));

        embeddingRepo.saveEmbeddings(toSave);

        totalEmbedded += batch.length;
        totalTokens += batchTokens;

        if (totalEmbedded % 200 === 0) {
          console.log(`[EMBED] Progress: ${totalEmbedded} chunks embedded, ${totalTokens} tokens used`);
        }
      } catch (error) {
        console.error(`[EMBED] Error embedding episode ${episode.episodeNumber}:`, error);
        // Continue with next batch
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  db.close();
  console.log(`[EMBED] Complete. ${totalChunks} total chunks, ${totalEmbedded} newly embedded, ${totalTokens} tokens used.`);
}

main().catch((err) => {
  console.error("[EMBED] Error:", err.message);
  process.exit(1);
});
