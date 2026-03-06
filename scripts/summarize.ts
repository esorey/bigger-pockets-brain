/**
 * Summarization script - generates structured summaries for all episodes
 *
 * Uses Claude to create summaries with:
 * - Narrative (guest story)
 * - Key takeaways
 * - Strategies discussed
 * - Markets mentioned
 * - Context (time period, market conditions)
 */

import { runSummarization } from "../src/processing";

async function main() {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error("[SUMMARIZE] CLAUDE_API_KEY not set");
    process.exit(1);
  }

  console.log("[SUMMARIZE] Starting summarization pipeline...");

  const result = await runSummarization({
    onProgress: (progress) => {
      if (progress.completed > 0 && progress.completed % 10 === 0) {
        console.log(`[SUMMARIZE] Progress: ${progress.completed}/${progress.total} (${progress.failed} failed)`);
      }
    },
  });

  console.log(`[SUMMARIZE] Final: ${result.completed} summarized, ${result.failed} failed`);
}

main().catch((err) => {
  console.error("[SUMMARIZE] Error:", err.message);
  process.exit(1);
});
