import Anthropic from "@anthropic-ai/sdk";
import type { Episode } from "../types";
import { initializeDatabase, EpisodeRepository } from "../db";
import { loadConfig } from "../config";

const SUMMARY_PROMPT = `You are summarizing a BiggerPockets podcast episode transcript.

Create a ~1000 word summary with these sections:

1. **NARRATIVE**: Who was on the show? What's their real estate story? How did they get started and where are they now?

2. **KEY TAKEAWAYS**: Main lessons and actionable insights from the episode. What can listeners apply to their own investing?

3. **STRATEGIES**: Investment strategies discussed (BRRRR, house hacking, wholesaling, buy-and-hold, flipping, multifamily, commercial, etc.)

4. **MARKETS**: Specific locations mentioned (states, cities, neighborhoods). Include any market-specific insights.

5. **CONTEXT**: Time period of events discussed, market conditions, economic context that may affect applicability of advice.

Format each section with a heading and clear, scannable content. Be specific - include numbers, timelines, and concrete details when mentioned.

---

Transcript:
`;

const MAX_TRANSCRIPT_TOKENS = 180_000; // Leave room for prompt and response
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

export interface SummarizeResult {
  success: boolean;
  summary?: string;
  error?: string;
  tokenCount?: number;
}

export interface SummarizeProgress {
  total: number;
  completed: number;
  failed: number;
  currentEpisode: number | null;
}

export interface SummarizeOptions {
  maxEpisodes?: number;
  onProgress?: (progress: SummarizeProgress) => void;
  onEpisode?: (episodeNumber: number, success: boolean) => void;
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

function truncateToTokenLimit(text: string, maxTokens: number): string {
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= maxTokens) {
    return text;
  }

  // Truncate to approximate token limit
  const ratio = maxTokens / estimatedTokens;
  const truncatedLength = Math.floor(text.length * ratio * 0.95); // 5% margin
  return text.slice(0, truncatedLength) + "\n\n[Transcript truncated due to length]";
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TranscriptSummarizer {
  private readonly client: Anthropic;
  private readonly model = "claude-sonnet-4-20250514";

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async summarize(transcript: string): Promise<SummarizeResult> {
    const truncatedTranscript = truncateToTokenLimit(transcript, MAX_TRANSCRIPT_TOKENS);
    const prompt = SUMMARY_PROMPT + truncatedTranscript;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const message = await this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        });

        const content = message.content[0];
        if (!content || content.type !== "text") {
          throw new Error("Unexpected response type from Claude API");
        }

        return {
          success: true,
          summary: content.text,
          tokenCount: message.usage.input_tokens + message.usage.output_tokens,
        };
      } catch (error) {
        lastError = error as Error;

        // Check if rate limited
        if (error instanceof Anthropic.RateLimitError) {
          console.error(`[SUMMARIZER] Rate limited, waiting ${RETRY_DELAY_MS * (attempt + 1)}ms...`);
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        // Check if server error (retriable)
        if (error instanceof Anthropic.InternalServerError) {
          console.error(`[SUMMARIZER] Server error, retrying in ${RETRY_DELAY_MS}ms...`);
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        // Non-retriable error
        break;
      }
    }

    return {
      success: false,
      error: lastError?.message ?? "Unknown error",
    };
  }
}

export async function runSummarization(
  options: SummarizeOptions = {}
): Promise<SummarizeProgress> {
  const config = loadConfig();
  const { db } = initializeDatabase({ dbPath: config.dbPath });
  const repo = new EpisodeRepository(db);
  const summarizer = new TranscriptSummarizer(config.claudeApiKey);

  // Get fetched episodes that haven't been summarized
  const fetched = repo.getEpisodesByStatus("fetched");
  const toSummarize = options.maxEpisodes
    ? fetched.slice(0, options.maxEpisodes)
    : fetched;

  const progress: SummarizeProgress = {
    total: toSummarize.length,
    completed: 0,
    failed: 0,
    currentEpisode: null,
  };

  console.log(`[SUMMARIZER] Starting summarization of ${progress.total} episodes...`);

  for (const episode of toSummarize) {
    if (!episode.transcriptText) {
      console.log(`[SUMMARIZER] Episode ${episode.episodeNumber}: no transcript, skipping`);
      continue;
    }

    progress.currentEpisode = episode.episodeNumber;
    options.onProgress?.(progress);

    console.log(`[SUMMARIZER] Episode ${episode.episodeNumber}: summarizing...`);

    const result = await summarizer.summarize(episode.transcriptText);

    if (result.success && result.summary) {
      repo.saveSummary(episode.episodeNumber, result.summary);
      progress.completed++;
      options.onEpisode?.(episode.episodeNumber, true);
      console.log(
        `[SUMMARIZER] Episode ${episode.episodeNumber}: success (${result.tokenCount} tokens)`
      );
    } else {
      progress.failed++;
      options.onEpisode?.(episode.episodeNumber, false);
      console.error(
        `[SUMMARIZER] Episode ${episode.episodeNumber}: failed - ${result.error}`
      );
    }

    options.onProgress?.(progress);
  }

  progress.currentEpisode = null;
  options.onProgress?.(progress);

  console.log(
    `[SUMMARIZER] Complete. ${progress.completed} summarized, ${progress.failed} failed.`
  );

  db.close();
  return progress;
}
