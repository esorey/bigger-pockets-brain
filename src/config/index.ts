import type { Config, EmbeddingProvider } from "../types";

const VALID_EMBEDDING_PROVIDERS: EmbeddingProvider[] = ["openai", "voyage", "local"];
const MIN_RATE_LIMIT = 0.1;
const MAX_RATE_LIMIT = 1.0;
const DEFAULT_RATE_LIMIT = 0.3;
const DEFAULT_DB_PATH = "./data/biggerpockets.db";
const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProvider = "openai";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(): Config {
  const claudeApiKey = process.env.CLAUDE_API_KEY;
  if (!claudeApiKey) {
    throw new ConfigError(
      "CLAUDE_API_KEY not set. Get your API key from https://console.anthropic.com/"
    );
  }

  const embeddingProviderRaw = process.env.BP_EMBEDDING_PROVIDER || DEFAULT_EMBEDDING_PROVIDER;
  if (!VALID_EMBEDDING_PROVIDERS.includes(embeddingProviderRaw as EmbeddingProvider)) {
    throw new ConfigError(
      `BP_EMBEDDING_PROVIDER must be one of: ${VALID_EMBEDDING_PROVIDERS.join(", ")}. Got: ${embeddingProviderRaw}`
    );
  }
  const embeddingProvider = embeddingProviderRaw as EmbeddingProvider;

  const embeddingApiKey = process.env.EMBEDDING_API_KEY;
  if (embeddingProvider !== "local" && !embeddingApiKey) {
    throw new ConfigError(
      `EMBEDDING_API_KEY required when using ${embeddingProvider} embeddings`
    );
  }

  const rateRaw = process.env.BP_SCRAPE_RATE;
  let scrapeRateLimit = DEFAULT_RATE_LIMIT;
  if (rateRaw) {
    const parsed = parseFloat(rateRaw);
    if (Number.isNaN(parsed)) {
      throw new ConfigError(`BP_SCRAPE_RATE must be a number. Got: ${rateRaw}`);
    }
    if (parsed < MIN_RATE_LIMIT || parsed > MAX_RATE_LIMIT) {
      throw new ConfigError(
        `BP_SCRAPE_RATE must be between ${MIN_RATE_LIMIT} and ${MAX_RATE_LIMIT}. Got: ${parsed}`
      );
    }
    scrapeRateLimit = parsed;
  }

  const dbPath = process.env.BP_DB_PATH || DEFAULT_DB_PATH;

  return {
    dbPath,
    claudeApiKey,
    embeddingProvider,
    embeddingApiKey,
    scrapeRateLimit,
  };
}

export type { Config, EmbeddingProvider };
