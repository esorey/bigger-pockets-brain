/**
 * Discovery + Fetch script - downloads all BiggerPockets podcast episodes
 * Fetches each episode by slug directly: real-estate-{N}
 * Counts down from latest (1246) to 1, extracting transcripts
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
  content: { rendered: string };
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTranscript(html: string): string | null {
  // Look for transcript section patterns
  const transcriptPatterns = [
    /<h[23][^>]*>.*?transcript.*?<\/h[23]>([\s\S]*?)(?=<h[23]|$)/i,
    /class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of transcriptPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return cleanHtml(match[1]);
    }
  }

  // Fallback: extract text from all substantial paragraphs
  const paragraphs: string[] = [];
  const pPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch;
  while ((pMatch = pPattern.exec(html)) !== null) {
    const text = cleanHtml(pMatch[1] || "");
    if (text.length > 50) {
      paragraphs.push(text);
    }
  }

  return paragraphs.length > 0 ? paragraphs.join("\n\n") : null;
}

interface FetchResult {
  post: Post | null;
  rateLimited: boolean;
  retryAfter?: number;
}

async function fetchEpisode(episodeNumber: number): Promise<FetchResult> {
  const slug = `real-estate-${episodeNumber}`;
  const url = `${BASE_URL}/posts?slug=${slug}&_fields=id,slug,title,date,link,content`;

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

  // Find where to resume from - skip already fetched episodes
  const existing = new Set<number>();
  for (const ep of repo.getAllEpisodes()) {
    if (ep.status === "fetched" || ep.status === "missing") {
      existing.add(ep.episodeNumber);
    }
  }

  const toFetch = [];
  for (let n = LATEST_EPISODE; n >= 1; n--) {
    if (!existing.has(n)) {
      toFetch.push(n);
    }
  }

  if (toFetch.length === 0) {
    console.log(`[FETCH] All ${LATEST_EPISODE} episodes already downloaded.`);
    db.close();
    return;
  }

  console.log(`[FETCH] ${existing.size} already done, ${toFetch.length} remaining (${toFetch[0]} down to ${toFetch[toFetch.length - 1]})...`);

  let fetched = 0;
  let noTranscript = 0;
  let notFound = 0;

  for (const n of toFetch) {
    const { post, rateLimited, retryAfter } = await fetchEpisode(n);

    if (rateLimited) {
      const retryMin = retryAfter ? Math.ceil(retryAfter / 60) : "?";
      console.log(`[FETCH] Rate limited at episode ${n}. Retry-After: ${retryAfter}s (~${retryMin} min)`);
      console.log(`[FETCH] Fetched ${fetched}, no transcript ${noTranscript}, not found ${notFound}. Resume from ${n}.`);
      break;
    }

    if (post) {
      const transcript = extractTranscript(post.content.rendered);
      const status = transcript ? "fetched" : "missing";

      repo.upsertEpisode({
        episodeNumber: n,
        slug: post.slug,
        title: cleanHtml(post.title.rendered),
        publishedAt: new Date(post.date),
        url: post.link,
        transcriptText: transcript,
        status,
        fetchedAt: new Date(),
      });

      if (transcript) {
        fetched++;
      } else {
        noTranscript++;
      }

      if ((fetched + noTranscript) % 50 === 0) {
        console.log(`[FETCH] Progress: ${fetched} fetched, ${noTranscript} no transcript, ${notFound} not found (at ep ${n})`);
      }
    } else {
      notFound++;
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  db.close();
  console.log(`[FETCH] Complete. ${fetched} fetched, ${noTranscript} no transcript, ${notFound} not found.`);
}

main().catch((err) => {
  console.error("[DISCOVERY] Error:", err.message);
  process.exit(1);
});
