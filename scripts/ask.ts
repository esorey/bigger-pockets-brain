/**
 * Interactive podcast search and chat
 *
 * Stage 1: Search episodes by query, show relevance one-liners
 * Stage 2: Chat with selected episode's full transcript
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  initializeDatabase,
  EpisodeRepository,
  EmbeddingRepository,
} from "../src/db";
import { TextEmbedder, findTopK } from "../src/processing";
import * as readline from "readline";

const TOP_K = 5;
const CHAT_MODEL = "claude-haiku-4-5-20241022";
const RELEVANCE_MODEL = "claude-haiku-4-5-20241022";

interface EpisodeMatch {
  episodeNumber: number;
  title: string;
  url: string;
  similarity: number;
  summary: string;
}

async function generateRelevanceLine(
  client: Anthropic,
  query: string,
  summary: string
): Promise<string> {
  const response = await client.messages.create({
    model: RELEVANCE_MODEL,
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: `Query: "${query}"

Episode summary:
${summary.slice(0, 2000)}

In one sentence (max 15 words), explain why this episode is relevant to the query. Be specific about what the episode covers that relates to the query. Start with a verb (e.g., "Covers...", "Explains...", "Features...").`,
      },
    ],
  });

  const content = response.content[0];
  if (content?.type === "text") {
    return content.text.trim();
  }
  return "Relevant episode";
}

async function searchEpisodes(
  query: string,
  embedder: TextEmbedder,
  embeddingRepo: EmbeddingRepository,
  episodeRepo: EpisodeRepository
): Promise<EpisodeMatch[]> {
  const { embedding: queryVector } = await embedder.embed(query);

  const summaryEmbeddings = embeddingRepo.getEmbeddingsByType("summary");
  const vectors = summaryEmbeddings.map((e) => ({
    id: e.referenceId,
    vector: e.vector,
  }));

  const topMatches = findTopK(queryVector, vectors, TOP_K);

  const results: EpisodeMatch[] = [];
  for (const match of topMatches) {
    const episode = episodeRepo.getEpisode(match.id);
    if (episode && episode.summary) {
      results.push({
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        url: episode.url,
        similarity: match.similarity,
        summary: episode.summary,
      });
    }
  }

  return results;
}

async function chatWithEpisode(
  client: Anthropic,
  episode: { episodeNumber: number; title: string; transcript: string },
  rl: readline.Interface
): Promise<void> {
  console.log(`\n--- Chatting with Episode ${episode.episodeNumber}: ${episode.title} ---`);
  console.log("Ask questions about this episode. Type 'exit' to return to search.\n");

  const systemPrompt = `You are a helpful assistant answering questions about a BiggerPockets podcast episode.

Episode ${episode.episodeNumber}: ${episode.title}

Full transcript:
${episode.transcript}

Answer questions based only on the transcript above. Be specific and cite details from the conversation. If something isn't covered in the transcript, say so.`;

  const messages: { role: "user" | "assistant"; content: string }[] = [];

  const askQuestion = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question("You: ", (answer) => resolve(answer));
    });
  };

  while (true) {
    const userInput = await askQuestion();

    if (userInput.toLowerCase() === "exit") {
      console.log("\nReturning to search...\n");
      break;
    }

    if (!userInput.trim()) continue;

    messages.push({ role: "user", content: userInput });

    try {
      const response = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });

      const content = response.content[0];
      if (content?.type === "text") {
        console.log(`\nAssistant: ${content.text}\n`);
        messages.push({ role: "assistant", content: content.text });
      }
    } catch (error) {
      console.error("Error:", (error as Error).message);
    }
  }
}

async function main() {
  const embeddingKey = process.env.EMBEDDING_API_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY;

  if (!embeddingKey || !claudeKey) {
    console.error("EMBEDDING_API_KEY and CLAUDE_API_KEY must be set");
    process.exit(1);
  }

  const { db } = initializeDatabase({ dbPath: "./data/biggerpockets.db" });
  const episodeRepo = new EpisodeRepository(db);
  const embeddingRepo = new EmbeddingRepository(db);
  const embedder = new TextEmbedder(embeddingKey);
  const client = new Anthropic({ apiKey: claudeKey });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("BiggerPockets Podcast Search");
  console.log("============================\n");

  const askQuery = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question("Search: ", (answer) => resolve(answer));
    });
  };

  const askEpisode = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question("\nDive deeper? Enter episode number (or 'q' to search again): ", (answer) =>
        resolve(answer)
      );
    });
  };

  while (true) {
    const query = await askQuery();

    if (query.toLowerCase() === "q" || query.toLowerCase() === "quit") {
      break;
    }

    if (!query.trim()) continue;

    console.log("\nSearching...\n");

    const matches = await searchEpisodes(query, embedder, embeddingRepo, episodeRepo);

    if (matches.length === 0) {
      console.log("No matching episodes found.\n");
      continue;
    }

    console.log(`Found ${matches.length} relevant episodes:\n`);

    // Generate relevance one-liners in parallel
    const relevancePromises = matches.map((m) =>
      generateRelevanceLine(client, query, m.summary)
    );
    const relevanceLines = await Promise.all(relevancePromises);

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const year = m.url.match(/(\d{4})/)?.[1] || "";
      console.log(`${i + 1}. Ep ${m.episodeNumber}: ${m.title}`);
      console.log(`   -> ${relevanceLines[i]}`);
      console.log();
    }

    const choice = await askEpisode();

    if (choice.toLowerCase() === "q") {
      console.log();
      continue;
    }

    const episodeNum = parseInt(choice, 10);
    const selected = matches.find((m) => m.episodeNumber === episodeNum);

    if (!selected) {
      console.log("Invalid episode number.\n");
      continue;
    }

    const fullEpisode = episodeRepo.getEpisode(episodeNum);
    if (!fullEpisode || !fullEpisode.transcriptText) {
      console.log("Episode transcript not available.\n");
      continue;
    }

    await chatWithEpisode(
      client,
      {
        episodeNumber: fullEpisode.episodeNumber,
        title: fullEpisode.title,
        transcript: fullEpisode.transcriptText,
      },
      rl
    );
  }

  rl.close();
  db.close();
  console.log("Goodbye!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
