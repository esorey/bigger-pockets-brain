# BiggerPockets Brain — Scraping & RAG Plan

## What This Is

2am fun project. Smart index for BiggerPockets podcast transcripts. Search to find relevant episodes, then read them.

## Success Criteria

- All episodes scraped with transcripts + LLM-generated summaries
- Semantic search finds relevant episodes by concept, not just keywords
- Can pull full transcript or summary for any episode

## Phase 1: Scrape

**Source:** WordPress REST API — `https://www.biggerpockets.com/blog/wp-json/wp/v2/posts?slug=real-estate-{N}`

**Approach:**
1. Discovery pass: paginate posts, find all `real-estate-*` slugs
2. Fetch pass: get transcript for each

**Robustness:**
- Status: `pending | fetched | missing | failed`
- Conservative rate (0.2-0.5 req/sec)
- On 429: stop, resume manually later

**Time:** ~45-120 min for backfill

## Phase 2: Process

Decoupled from scraping — runs on stored transcripts.

**2a. Summarize**
LLM generates ~1000 word summary per episode:
- Narrative structure (who, what they did, how)
- Key takeaways / strategies
- States/markets mentioned
- Time period / context

**2b. Chunk**
Split transcript into ~500 word chunks with small overlap (~50 words).
Each chunk knows its episode + position (start/end char offsets).

## Phase 3: Embed & Index (Multi-Layer)

Embed at two granularities:
- **Summary embeddings** — conceptual discovery ("episodes about house hacking")
- **Chunk embeddings** — detail retrieval ("quit nursing job", "$47k cash flow")

Both point back to episodes. Search hits either layer, results grouped by episode.

**Why multi-layer:**
- Summary might compress out details (nursing job mentioned once → dropped)
- Chunks preserve everything — they ARE the transcript, just sliced
- Query matches best entry point, you still get episodes as results

## Phase 4: CLI

```
search <query>     # semantic search, returns ranked episodes + matching snippet
summary <N>        # show summary for episode N
episode <N>        # show full transcript for episode N
```

**Search output example:**
```
1. Episode 1246 - "$1 Rental Properties..." (Mar 2026)
   → "...quit my nursing job after hitting $4k/month cash flow..."

2. Episode 803 - "From ER Nurse to 15 Units" (Oct 2024)
   → "...was working doubles in the ER, started house hacking..."
```

Pick episodes, drill down, think for yourself.

---

## Schema (v0)

```sql
episodes (
  episode_number INTEGER PRIMARY KEY,
  slug TEXT UNIQUE,
  title TEXT,
  published_at TEXT,
  url TEXT,
  transcript_text TEXT,
  summary TEXT,
  status TEXT,
  fetched_at TEXT
)

chunks (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER REFERENCES episodes,
  chunk_index INTEGER,
  chunk_text TEXT,
  start_char INTEGER,
  end_char INTEGER
)

-- embeddings stored in sqlite-vec virtual table
-- vectors for both summaries and chunks, tagged by type
```

## Tech Stack

- Bun + TypeScript
- SQLite (WAL mode) + sqlite-vec
- Claude API for summarization
- Embedding model TBD (OpenAI, Voyage, or local)

## Later (not v0)

- **Atomic fact extraction** — hundreds of micro-facts per episode for number/detail queries (~$15 to add)
- Higher-level queries that use search as a tool
- Cross-episode synthesis
- Web UI
