import type { SearchResult } from "../types";

export interface CommandContext {
  args: string[];
}

export interface CommandHandler {
  name: string;
  description: string;
  usage: string;
  run(ctx: CommandContext): Promise<void>;
}

export class CLIError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1
  ) {
    super(message);
    this.name = "CLIError";
  }
}

export function formatError(error: unknown): string {
  if (error instanceof CLIError) {
    return `Error: ${error.message}`;
  }
  if (error instanceof Error) {
    if (error.message.includes("SQLITE")) {
      return `Database error: ${error.message}`;
    }
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No matching episodes found.";
  }

  return results
    .map((r, i) => {
      const date = r.publishedAt.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
      return `${i + 1}. Episode ${r.episodeNumber} - "${r.title}" (${date})
   → "${r.matchingSnippet}"`;
    })
    .join("\n\n");
}

const HELP_TEXT = `
BiggerPockets Brain - Semantic search for podcast transcripts

Usage:
  bp <command> [arguments]

Commands:
  search <query>     Search episodes by concept
  summary <N>        Show LLM-generated summary for episode N
  episode <N>        Show full transcript for episode N

Options:
  --help, -h         Show this help message

Examples:
  bp search "house hacking strategies"
  bp summary 1246
  bp episode 803
`.trim();

export function showHelp(): void {
  console.log(HELP_TEXT);
}

export function parseArgs(argv: string[]): { command: string | null; args: string[] } {
  const args = argv.slice(2); // skip bun and script path
  const command = args[0] ?? null;

  if (!command || command === "--help" || command === "-h") {
    return { command: null, args: [] };
  }

  return { command, args: args.slice(1) };
}

export function validateEpisodeNumber(arg: string | undefined): number {
  if (!arg) {
    throw new CLIError("Episode number required");
  }

  const num = parseInt(arg, 10);
  if (Number.isNaN(num) || num < 1) {
    throw new CLIError(`Invalid episode number: ${arg}`);
  }

  return num;
}

export function validateSearchQuery(args: string[]): string {
  const query = args.join(" ").trim();
  if (!query) {
    throw new CLIError("Search query required");
  }
  return query;
}
