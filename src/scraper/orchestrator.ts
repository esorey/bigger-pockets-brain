import type { EpisodeStatus } from "../types";
import { initializeDatabase, EpisodeRepository } from "../db";
import { loadConfig } from "../config";
import {
  discoverEpisodes,
  fetchEpisodeByNumber,
  metadataToEpisode,
  WordPressClientError,
  type EpisodeMetadata,
} from "./wordpress-client";

export interface ScrapeProgress {
  total: number;
  completed: number;
  pending: number;
  failed: number;
  currentEpisode: number | null;
  startedAt: Date;
  estimatedSecondsRemaining: number | null;
}

export interface ScrapeOptions {
  maxEpisodes?: number;
  onProgress?: (progress: ScrapeProgress) => void;
  onEpisode?: (episodeNumber: number, status: EpisodeStatus) => void;
}

export class RateLimitedScraper {
  private readonly delayMs: number;
  private readonly repo: EpisodeRepository;
  private stopped = false;

  constructor(repo: EpisodeRepository, requestsPerSecond: number) {
    this.repo = repo;
    this.delayMs = 1000 / requestsPerSecond;
  }

  stop(): void {
    this.stopped = true;
  }

  private async delay(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  async discover(
    onPage?: (page: number, count: number) => void
  ): Promise<number> {
    const episodes = await discoverEpisodes(onPage);

    // Upsert all discovered episodes as pending
    const newEpisodes = episodes.map((meta) => ({
      episodeNumber: meta.episodeNumber,
      slug: meta.slug,
      title: meta.title,
      publishedAt: meta.publishedAt,
      url: meta.url,
      status: "pending" as const,
    }));

    this.repo.upsertEpisodes(newEpisodes);
    return episodes.length;
  }

  async scrape(options: ScrapeOptions = {}): Promise<ScrapeProgress> {
    const startedAt = new Date();
    this.stopped = false;

    // Get pending and failed episodes
    const pending = this.repo.getEpisodesByStatus("pending");
    const failed = this.repo.getEpisodesByStatus("failed");
    const toFetch = [...pending, ...failed];

    if (options.maxEpisodes) {
      toFetch.splice(options.maxEpisodes);
    }

    const progress: ScrapeProgress = {
      total: toFetch.length,
      completed: 0,
      pending: toFetch.length,
      failed: 0,
      currentEpisode: null,
      startedAt,
      estimatedSecondsRemaining: null,
    };

    for (const episode of toFetch) {
      if (this.stopped) {
        break;
      }

      progress.currentEpisode = episode.episodeNumber;
      options.onProgress?.(progress);

      try {
        const result = await fetchEpisodeByNumber(episode.episodeNumber);
        const updatedEpisode = metadataToEpisode(
          result.metadata,
          result.transcript,
          result.status
        );

        this.repo.upsertEpisode(updatedEpisode);
        progress.completed++;
        progress.pending--;
        options.onEpisode?.(episode.episodeNumber, result.status);
      } catch (error) {
        if (error instanceof WordPressClientError) {
          if (error.statusCode === 429) {
            // Rate limited - stop immediately
            console.error(
              `[SCRAPER] Rate limited at episode ${episode.episodeNumber}. Stopping.`
            );
            this.stopped = true;
            break;
          }

          if (error.statusCode === 404) {
            // Episode doesn't exist
            this.repo.updateStatus(episode.episodeNumber, "missing");
            progress.completed++;
            progress.pending--;
            options.onEpisode?.(episode.episodeNumber, "missing");
          } else {
            // Other error - mark as failed
            this.repo.updateStatus(episode.episodeNumber, "failed");
            progress.failed++;
            progress.pending--;
            options.onEpisode?.(episode.episodeNumber, "failed");
          }
        } else {
          // Unknown error - mark as failed
          this.repo.updateStatus(episode.episodeNumber, "failed");
          progress.failed++;
          progress.pending--;
          options.onEpisode?.(episode.episodeNumber, "failed");
          console.error(
            `[SCRAPER] Error fetching episode ${episode.episodeNumber}:`,
            error
          );
        }
      }

      // Calculate ETA
      const elapsed = Date.now() - startedAt.getTime();
      const avgTimePerEpisode = elapsed / progress.completed || this.delayMs;
      progress.estimatedSecondsRemaining = Math.ceil(
        (progress.pending * avgTimePerEpisode) / 1000
      );

      options.onProgress?.(progress);

      // Rate limit delay
      if (!this.stopped && progress.pending > 0) {
        await this.delay();
      }
    }

    progress.currentEpisode = null;
    options.onProgress?.(progress);

    return progress;
  }
}

export async function runDiscovery(): Promise<number> {
  const config = loadConfig();
  const { db } = initializeDatabase({ dbPath: config.dbPath });
  const repo = new EpisodeRepository(db);
  const scraper = new RateLimitedScraper(repo, config.scrapeRateLimit);

  console.log("[DISCOVERY] Starting episode discovery...");
  let pageCount = 0;

  const count = await scraper.discover((page, found) => {
    pageCount = page;
    console.log(`[DISCOVERY] Page ${page}: found ${found} posts`);
  });

  console.log(
    `[DISCOVERY] Complete. Found ${count} episodes across ${pageCount} pages.`
  );
  db.close();
  return count;
}

export async function runScrape(maxEpisodes?: number): Promise<ScrapeProgress> {
  const config = loadConfig();
  const { db } = initializeDatabase({ dbPath: config.dbPath });
  const repo = new EpisodeRepository(db);
  const scraper = new RateLimitedScraper(repo, config.scrapeRateLimit);

  console.log(
    `[SCRAPER] Starting scrape at ${config.scrapeRateLimit} req/sec...`
  );
  if (maxEpisodes) {
    console.log(`[SCRAPER] Limited to ${maxEpisodes} episodes`);
  }

  let lastLoggedAt = 0;
  const LOG_INTERVAL_MS = 30_000; // Log summary every 30 seconds

  const progress = await scraper.scrape({
    maxEpisodes,
    onEpisode: (num, status) => {
      console.log(`[SCRAPER] Episode ${num}: ${status}`);
    },
    onProgress: (p) => {
      const now = Date.now();
      if (now - lastLoggedAt > LOG_INTERVAL_MS) {
        lastLoggedAt = now;
        const eta = p.estimatedSecondsRemaining
          ? `ETA: ${Math.ceil(p.estimatedSecondsRemaining / 60)}m`
          : "";
        console.log(
          `[SCRAPER] Progress: ${p.completed}/${p.total} (${p.failed} failed) ${eta}`
        );
      }
    },
  });

  console.log(
    `[SCRAPER] Complete. ${progress.completed} fetched, ${progress.failed} failed, ${progress.pending} remaining.`
  );
  db.close();
  return progress;
}
