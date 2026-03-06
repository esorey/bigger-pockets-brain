/**
 * Discovery script - finds all BiggerPockets podcast episodes
 * Fetches each episode by slug directly: real-estate-{N}
 * Counts down from latest (1246) to 1
 */

import { initializeDatabase, EpisodeRepository } from "../src/db";

const BASE_URL = "https://www.biggerpockets.com/blog/wp-json/wp/v2";
const LATEST_EPISODE = 1246;
const DELAY_MS = 2000; // 2 seconds between requests to avoid Cloudflare rate limits

interface Post {
  id: number;
  slug: string;
  title: { rendered: string };
  date: string;
  link: string;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[^;]+;/g, " ")
    .trim();
}

interface FetchResult {
  post: Post | null;
  rateLimited: boolean;
  retryAfter?: number;
}

async function fetchEpisode(episodeNumber: number): Promise<FetchResult> {
  const slug = `real-estate-${episodeNumber}`;
  const url = `${BASE_URL}/posts?slug=${slug}&_fields=id,slug,title,date,link`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "BiggerPocketsBrain/1.0",
    },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "0", 10);
    return { post: null, rateLimited: true, retryAfter };
  }
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status}`);
  }

  const posts = (await res.json()) as Post[];
  return { post: posts[0] ?? null, rateLimited: false };
}

async function main() {
  const { db } = initializeDatabase({ dbPath: "./data/biggerpockets.db" });
  const repo = new EpisodeRepository(db);

  console.log(`[DISCOVERY] Fetching episodes ${LATEST_EPISODE} down to 1...`);

  let found = 0;
  let missing = 0;

  for (let n = LATEST_EPISODE; n >= 1; n--) {
    const { post, rateLimited, retryAfter } = await fetchEpisode(n);

    if (rateLimited) {
      const retryMin = retryAfter ? Math.ceil(retryAfter / 60) : "?";
      console.log(`[DISCOVERY] Rate limited at episode ${n}. Retry-After: ${retryAfter}s (~${retryMin} min)`);
      console.log(`[DISCOVERY] Found ${found}, missing ${missing}. Resume from episode ${n} later.`);
      break;
    }

    if (post) {
      repo.upsertEpisode({
        episodeNumber: n,
        slug: post.slug,
        title: cleanHtml(post.title.rendered),
        publishedAt: new Date(post.date),
        url: post.link,
        status: "pending",
      });
      found++;

      if (found % 50 === 0) {
        console.log(`[DISCOVERY] Progress: ${found} found, ${missing} missing (at episode ${n})`);
      }
    } else {
      missing++;
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  db.close();
  console.log(`[DISCOVERY] Complete. ${found} episodes found, ${missing} missing.`);
}

main().catch((err) => {
  console.error("[DISCOVERY] Error:", err.message);
  process.exit(1);
});
