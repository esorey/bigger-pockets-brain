/**
 * Embed summaries for episode-level search
 */

import {
  initializeDatabase,
  EpisodeRepository,
  EmbeddingRepository,
} from "../src/db";
import { TextEmbedder } from "../src/processing";

const BATCH_SIZE = 50;

async function main() {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) {
    console.error("[EMBED] EMBEDDING_API_KEY not set");
    process.exit(1);
  }

  const { db } = initializeDatabase({ dbPath: "./data/biggerpockets.db" });
  const episodeRepo = new EpisodeRepository(db);
  const embeddingRepo = new EmbeddingRepository(db);
  const embedder = new TextEmbedder(apiKey);

  // Get summarized episodes
  const episodes = episodeRepo.getEpisodesByStatus("summarized");
  console.log(`[EMBED] Found ${episodes.length} summarized episodes`);

  // Check which already have summary embeddings
  const existing = new Set(
    embeddingRepo.getEmbeddingsByType("summary").map((e) => e.referenceId)
  );

  const toEmbed = episodes.filter(
    (ep) => ep.summary && !existing.has(ep.episodeNumber)
  );

  if (toEmbed.length === 0) {
    console.log("[EMBED] All summaries already embedded");
    db.close();
    return;
  }

  console.log(`[EMBED] ${existing.size} already done, ${toEmbed.length} to embed`);

  let embedded = 0;
  let totalTokens = 0;

  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    const texts = batch.map((ep) => ep.summary!);

    const { embeddings, totalTokens: batchTokens } = await embedder.embedBatch(texts);

    const toSave = batch.map((ep, idx) => ({
      referenceId: ep.episodeNumber,
      type: "summary" as const,
      episodeNumber: ep.episodeNumber,
      vector: embeddings[idx],
    }));

    embeddingRepo.saveEmbeddings(toSave);
    embedded += batch.length;
    totalTokens += batchTokens;

    console.log(`[EMBED] Progress: ${embedded}/${toEmbed.length} summaries embedded`);
  }

  db.close();
  console.log(`[EMBED] Complete. ${embedded} summaries embedded, ${totalTokens} tokens used.`);
}

main().catch((err) => {
  console.error("[EMBED] Error:", err.message);
  process.exit(1);
});
