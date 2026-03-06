import type { EmbeddingType, SearchResult } from "../types";

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

export type SearchLayer = EmbeddingType | "both";

export interface SearchCommandOptions {
  query: string;
  limit: number;
  verbose: boolean;
  layer: SearchLayer;
}

const DEFAULT_SEARCH_LIMIT = 10;
const VALID_LAYERS: SearchLayer[] = ["summary", "chunk", "both"];

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

export function formatSearchResults(
  results: SearchResult[],
  options: { verbose?: boolean } = {}
): string {
  if (results.length === 0) {
    return "No matching episodes found.";
  }

  const verbose = options.verbose ?? false;

  return results
    .map((r, i) => {
      const date = r.publishedAt.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
      const base = `${i + 1}. Episode ${r.episodeNumber} - "${r.title}" (${date})
   → "${r.matchingSnippet}"`;

      if (!verbose) {
        return base;
      }

      return `${base}
   [score=${r.similarity.toFixed(3)} layer=${r.matchType}]`;
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

Search Options:
  --limit N          Number of results (default: 10)
  --verbose          Show similarity score + matched layer
  --layer <value>    Restrict to summary|chunk|both (default: both)

Examples:
  bp search "house hacking strategies"
  bp search "nurse quit job" --limit 5 --verbose --layer chunk
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

export function parseSearchCommandOptions(args: string[]): SearchCommandOptions {
  const queryTokens: string[] = [];
  let limit = DEFAULT_SEARCH_LIMIT;
  let verbose = false;
  let layer: SearchLayer = "both";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--limit") {
      const raw = args[i + 1];
      if (!raw) {
        throw new CLIError("--limit requires a value");
      }
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new CLIError(`Invalid --limit value: ${raw}`);
      }
      limit = parsed;
      i++;
      continue;
    }

    if (arg === "--verbose") {
      verbose = true;
      continue;
    }

    if (arg === "--layer") {
      const raw = args[i + 1];
      if (!raw) {
        throw new CLIError("--layer requires a value (summary|chunk|both)");
      }
      if (!VALID_LAYERS.includes(raw as SearchLayer)) {
        throw new CLIError(`Invalid --layer value: ${raw}`);
      }
      layer = raw as SearchLayer;
      i++;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new CLIError(`Unknown search option: ${arg}`);
    }

    queryTokens.push(arg);
  }

  const query = validateSearchQuery(queryTokens);

  return {
    query,
    limit,
    verbose,
    layer,
  };
}
