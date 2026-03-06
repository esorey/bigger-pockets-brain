#!/usr/bin/env bun
/**
 * BiggerPockets Brain CLI
 *
 * Commands:
 *   bp search <query>   - Semantic search for episodes
 *   bp summary <N>      - Show summary for episode N
 *   bp episode <N>      - Show full transcript for episode N
 */

import {
  parseArgs,
  parseSearchCommandOptions,
  showHelp,
  formatError,
  formatSearchResults,
  CLIError,
  validateEpisodeNumber,
} from "./src/cli";
import { initializeDatabase } from "./src/db";
import { searchEpisodes, hasVectorTables } from "./src/search";
import { createEmbeddingService } from "./src/embeddings";

interface EpisodeRow {
  episode_number: number;
  title: string;
  published_at: string;
  url: string;
  transcript_text: string | null;
  summary: string | null;
  status: string;
}

function formatEpisodeOutput(episode: EpisodeRow, raw: boolean): string {
  if (raw) {
    return episode.transcript_text ?? "";
  }

  const date = new Date(episode.published_at).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  let output = `# Episode ${episode.episode_number}: ${episode.title} (${date})\n`;
  output += `Source: ${episode.url}\n\n`;
  output += episode.transcript_text ?? "(No transcript available)";

  return output;
}

function formatSummaryOutput(episode: EpisodeRow, raw: boolean): string {
  if (raw) {
    return episode.summary ?? "";
  }

  const date = new Date(episode.published_at).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  let output = `# Episode ${episode.episode_number}: ${episode.title} (${date})\n\n`;
  output += `## Summary\n\n`;
  output += episode.summary ?? "(No summary available)";

  return output;
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv);

  if (!command) {
    showHelp();
    return;
  }

  switch (command) {
    case "search": {
      const { query, limit, verbose, layer } = parseSearchCommandOptions(args);

      // Initialize database
      const { db } = initializeDatabase();

      // Check if embeddings exist
      if (!hasVectorTables(db)) {
        db.close();
        throw new CLIError(
          "No embeddings found. Run the embedding pipeline first."
        );
      }

      // Create embedding service
      const apiKey = process.env.EMBEDDING_API_KEY;
      if (!apiKey) {
        db.close();
        throw new CLIError("EMBEDDING_API_KEY environment variable required for search");
      }

      const embeddingService = createEmbeddingService("openai", { apiKey });

      // Search
      const types = layer === "both" ? undefined : [layer];
      const results = await searchEpisodes(db, embeddingService, query, {
        limit,
        types,
      });

      // Output results
      console.log(formatSearchResults(results, { verbose }));

      db.close();
      break;
    }

    case "summary": {
      // Parse options
      const rawFlag = args.includes("--raw");
      const nonFlagArgs = args.filter((a) => !a.startsWith("--"));
      const episodeNum = validateEpisodeNumber(nonFlagArgs[0]);

      // Initialize database
      const { db } = initializeDatabase();

      // Query episode
      const episode = db
        .prepare(
          `SELECT episode_number, title, published_at, url, summary, status
           FROM episodes WHERE episode_number = ?`
        )
        .get(episodeNum) as EpisodeRow | undefined;

      if (!episode) {
        db.close();
        throw new CLIError(`Episode ${episodeNum} does not exist`);
      }

      if (!episode.summary) {
        db.close();
        throw new CLIError(
          `Episode ${episodeNum} exists but has not been summarized yet`
        );
      }

      // Output formatted summary
      console.log(formatSummaryOutput(episode, rawFlag));

      db.close();
      break;
    }

    case "episode": {
      // Parse options
      const rawFlag = args.includes("--raw");
      const openFlag = args.includes("--open");
      const nonFlagArgs = args.filter((a) => !a.startsWith("--"));
      const episodeNum = validateEpisodeNumber(nonFlagArgs[0]);

      // Initialize database
      const { db } = initializeDatabase();

      // Query episode
      const episode = db
        .prepare(
          `SELECT episode_number, title, published_at, url, transcript_text, status
           FROM episodes WHERE episode_number = ?`
        )
        .get(episodeNum) as EpisodeRow | undefined;

      if (!episode) {
        throw new CLIError(`Episode ${episodeNum} does not exist`);
      }

      if (!episode.transcript_text && episode.status === "missing") {
        throw new CLIError(
          `Episode ${episodeNum} exists but transcript not available`
        );
      }

      // Open in browser if requested
      if (openFlag && episode.url) {
        const { spawn } = await import("child_process");
        spawn("xdg-open", [episode.url], { detached: true, stdio: "ignore" });
      }

      // Output formatted text
      console.log(formatEpisodeOutput(episode, rawFlag));

      db.close();
      break;
    }

    default:
      throw new CLIError(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(error instanceof CLIError ? error.exitCode : 1);
});
