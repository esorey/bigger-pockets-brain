import type { Episode, EpisodeStatus } from "../types";

const BASE_URL = "https://www.biggerpockets.com/blog/wp-json/wp/v2";
const POSTS_PER_PAGE = 100;

export class WordPressClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "WordPressClientError";
  }
}

export interface RawPost {
  id: number;
  slug: string;
  title: { rendered: string };
  date: string;
  link: string;
  content: { rendered: string };
}

export interface EpisodeMetadata {
  episodeNumber: number;
  slug: string;
  title: string;
  publishedAt: Date;
  url: string;
}

function parseEpisodeNumber(slug: string): number | null {
  const match = slug.match(/^real-estate-(\d+)$/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

function extractTranscript(html: string): string | null {
  // Look for transcript section - usually marked with specific patterns
  // BiggerPockets typically has "Transcript" or similar heading
  const transcriptPatterns = [
    /<h[23][^>]*>.*?transcript.*?<\/h[23]>([\s\S]*?)(?=<h[23]|$)/i,
    /class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<p[^>]*>([\s\S]*?)<\/p>/gi, // Fallback: extract all paragraphs
  ];

  for (const pattern of transcriptPatterns.slice(0, 2)) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return cleanHtml(match[1]);
    }
  }

  // Fallback: extract text content from all paragraphs
  const paragraphs: string[] = [];
  const pPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch;
  while ((pMatch = pPattern.exec(html)) !== null) {
    const captured = pMatch[1];
    if (captured) {
      const text = cleanHtml(captured);
      if (text.length > 50) {
        paragraphs.push(text);
      }
    }
  }

  return paragraphs.length > 0 ? paragraphs.join("\n\n") : null;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "BiggerPocketsBrain/1.0",
    },
  });

  if (response.status === 429) {
    throw new WordPressClientError("Rate limited by server", 429, true);
  }

  if (response.status === 404) {
    throw new WordPressClientError("Resource not found", 404, false);
  }

  if (!response.ok) {
    throw new WordPressClientError(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      response.status >= 500
    );
  }

  return response.json() as Promise<T>;
}

export async function discoverEpisodes(
  onPage?: (page: number, count: number) => void
): Promise<EpisodeMetadata[]> {
  const episodes: EpisodeMetadata[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${BASE_URL}/posts?per_page=${POSTS_PER_PAGE}&page=${page}&_fields=id,slug,title,date,link`;

    try {
      const posts = await fetchJson<RawPost[]>(url);

      for (const post of posts) {
        const episodeNumber = parseEpisodeNumber(post.slug);
        if (episodeNumber !== null) {
          episodes.push({
            episodeNumber,
            slug: post.slug,
            title: cleanHtml(post.title.rendered),
            publishedAt: new Date(post.date),
            url: post.link,
          });
        }
      }

      onPage?.(page, posts.length);
      hasMore = posts.length === POSTS_PER_PAGE;
      page++;
    } catch (error) {
      if (error instanceof WordPressClientError && error.statusCode === 400) {
        // No more pages
        hasMore = false;
      } else {
        throw error;
      }
    }
  }

  return episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

export async function fetchEpisodeBySlug(slug: string): Promise<{
  metadata: EpisodeMetadata;
  transcript: string | null;
  status: EpisodeStatus;
}> {
  const url = `${BASE_URL}/posts?slug=${encodeURIComponent(slug)}&_fields=id,slug,title,date,link,content`;

  const posts = await fetchJson<RawPost[]>(url);

  const post = posts[0];
  if (!post) {
    throw new WordPressClientError(`Episode not found: ${slug}`, 404, false);
  }

  const episodeNumber = parseEpisodeNumber(post.slug);

  if (episodeNumber === null) {
    throw new WordPressClientError(`Invalid episode slug: ${slug}`, 400, false);
  }

  const transcript = extractTranscript(post.content.rendered);

  return {
    metadata: {
      episodeNumber,
      slug: post.slug,
      title: cleanHtml(post.title.rendered),
      publishedAt: new Date(post.date),
      url: post.link,
    },
    transcript,
    status: transcript ? "fetched" : "missing",
  };
}

export async function fetchEpisodeByNumber(episodeNumber: number): Promise<{
  metadata: EpisodeMetadata;
  transcript: string | null;
  status: EpisodeStatus;
}> {
  return fetchEpisodeBySlug(`real-estate-${episodeNumber}`);
}

export function metadataToEpisode(
  metadata: EpisodeMetadata,
  transcript: string | null,
  status: EpisodeStatus
): Episode {
  return {
    ...metadata,
    transcriptText: transcript,
    summary: null,
    status,
    fetchedAt: status === "fetched" || status === "missing" ? new Date() : null,
    summarizedAt: null,
  };
}
