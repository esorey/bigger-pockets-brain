import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { TranscriptSummarizer } from "../../src/processing/summarizer";

type CreateMessageInput = Parameters<Anthropic.Messages["create"]>[0];

function createTextResponse(text: string, inputTokens = 120, outputTokens = 380) {
  return {
    content: [{ type: "text", text }],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

function createNonTextResponse() {
  return {
    content: [{ type: "tool_use", id: "tool_1", name: "noop", input: {} }],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
    },
  };
}

function makeRateLimitError(message = "rate limited") {
  return new Anthropic.RateLimitError(
    429,
    { type: "error", error: { type: "rate_limit_error", message } },
    message,
    new Headers()
  );
}

function makeInternalServerError(message = "internal server error") {
  return new Anthropic.InternalServerError(
    500,
    { type: "error", error: { type: "api_error", message } },
    message,
    new Headers()
  );
}

function getCreateMock(
  summarizer: TranscriptSummarizer
): (args: CreateMessageInput) => Promise<unknown> {
  return (summarizer as any).client.messages.create as (
    args: CreateMessageInput
  ) => Promise<unknown>;
}

function setCreateMock(
  summarizer: TranscriptSummarizer,
  fn: (args: CreateMessageInput) => Promise<unknown>
) {
  (summarizer as any).client.messages.create = fn;
}

describe("TranscriptSummarizer", () => {
  const originalSetTimeout = globalThis.setTimeout;

  beforeEach(() => {
    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 0 as any;
    }) as typeof setTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  test("builds prompt with required section headings", async () => {
    const summarizer = new TranscriptSummarizer("test-key");
    let capturedPrompt = "";

    setCreateMock(summarizer, async (args) => {
      const message = args.messages[0];
      capturedPrompt = message?.content as string;
      return createTextResponse("## NARRATIVE\nA story\n\n## KEY TAKEAWAYS\nLessons");
    });

    const result = await summarizer.summarize("Small transcript body.");

    expect(result.success).toBe(true);
    expect(capturedPrompt).toContain("1. **NARRATIVE**");
    expect(capturedPrompt).toContain("2. **KEY TAKEAWAYS**");
    expect(capturedPrompt).toContain("3. **STRATEGIES**");
    expect(capturedPrompt).toContain("4. **MARKETS**");
    expect(capturedPrompt).toContain("5. **CONTEXT**");
    expect(capturedPrompt).toContain("Transcript:");
    expect(capturedPrompt).toContain("Small transcript body.");
  });

  test("truncates transcript above token limit and appends truncation marker", async () => {
    const summarizer = new TranscriptSummarizer("test-key");
    let capturedPrompt = "";
    const longTranscript = "word ".repeat(900_000);

    setCreateMock(summarizer, async (args) => {
      capturedPrompt = args.messages[0]?.content as string;
      return createTextResponse("summary");
    });

    const result = await summarizer.summarize(longTranscript);

    expect(result.success).toBe(true);
    expect(capturedPrompt.length).toBeLessThan(longTranscript.length + 500);
    expect(capturedPrompt).toContain("[Transcript truncated due to length]");
  });

  test("returns summary text and total token count on success", async () => {
    const summarizer = new TranscriptSummarizer("test-key");

    setCreateMock(summarizer, async () =>
      createTextResponse("Structured summary output.", 222, 333)
    );

    const result = await summarizer.summarize("Transcript");

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Structured summary output.");
    expect(result.tokenCount).toBe(555);
  });

  test("handles empty transcript input", async () => {
    const summarizer = new TranscriptSummarizer("test-key");
    let capturedPrompt = "";

    setCreateMock(summarizer, async (args) => {
      capturedPrompt = args.messages[0]?.content as string;
      return createTextResponse("Summary for empty transcript.");
    });

    const result = await summarizer.summarize("");

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Summary");
    expect(capturedPrompt).toContain("Transcript:");
  });

  test("fails cleanly on non-text Claude response content", async () => {
    const summarizer = new TranscriptSummarizer("test-key");

    setCreateMock(summarizer, async () => createNonTextResponse());

    const result = await summarizer.summarize("Transcript");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unexpected response type");
  });

  test("retries on rate limit errors with increasing backoff", async () => {
    const summarizer = new TranscriptSummarizer("test-key");
    let attempts = 0;
    const delays: number[] = [];

    globalThis.setTimeout = ((handler: TimerHandler, ms?: number) => {
      delays.push(ms ?? 0);
      if (typeof handler === "function") {
        handler();
      }
      return 0 as any;
    }) as typeof setTimeout;

    setCreateMock(summarizer, async () => {
      attempts++;
      if (attempts < 3) {
        throw makeRateLimitError();
      }
      return createTextResponse("Recovered after retry.");
    });

    const result = await summarizer.summarize("Transcript");

    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
    expect(delays).toEqual([5000, 10000]);
  });

  test("retries on internal server errors and then succeeds", async () => {
    const summarizer = new TranscriptSummarizer("test-key");
    let attempts = 0;
    const delays: number[] = [];

    globalThis.setTimeout = ((handler: TimerHandler, ms?: number) => {
      delays.push(ms ?? 0);
      if (typeof handler === "function") {
        handler();
      }
      return 0 as any;
    }) as typeof setTimeout;

    setCreateMock(summarizer, async () => {
      attempts++;
      if (attempts === 1) {
        throw makeInternalServerError();
      }
      return createTextResponse("Recovered after server retry.");
    });

    const result = await summarizer.summarize("Transcript");

    expect(result.success).toBe(true);
    expect(attempts).toBe(2);
    expect(delays).toEqual([5000]);
  });

  test("does not retry non-retriable errors", async () => {
    const summarizer = new TranscriptSummarizer("test-key");
    let attempts = 0;

    setCreateMock(summarizer, async () => {
      attempts++;
      throw new Error("Invalid API key");
    });

    const result = await summarizer.summarize("Transcript");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid API key");
    expect(attempts).toBe(1);
  });

  test("returns failure after max retries are exhausted", async () => {
    const summarizer = new TranscriptSummarizer("test-key");
    let attempts = 0;
    const delays: number[] = [];

    globalThis.setTimeout = ((handler: TimerHandler, ms?: number) => {
      delays.push(ms ?? 0);
      if (typeof handler === "function") {
        handler();
      }
      return 0 as any;
    }) as typeof setTimeout;

    setCreateMock(summarizer, async () => {
      attempts++;
      throw makeRateLimitError("still rate limited");
    });

    const result = await summarizer.summarize("Transcript");

    expect(result.success).toBe(false);
    expect(result.error).toContain("still rate limited");
    expect(attempts).toBe(3);
    expect(delays).toEqual([5000, 10000, 15000]);
  });

  test("uses expected Claude model and max token settings", async () => {
    const summarizer = new TranscriptSummarizer("test-key");
    let capturedArgs: CreateMessageInput | null = null;

    setCreateMock(summarizer, async (args) => {
      capturedArgs = args;
      return createTextResponse("summary");
    });

    await summarizer.summarize("Transcript");

    expect(capturedArgs?.model).toBe("claude-sonnet-4-20250514");
    expect(capturedArgs?.max_tokens).toBe(2048);
    expect(capturedArgs?.messages.length).toBe(1);
    expect(capturedArgs?.messages[0]?.role).toBe("user");
  });

  test("test seam remains patchable for API mocking", () => {
    const summarizer = new TranscriptSummarizer("test-key");
    const createMock = getCreateMock(summarizer);
    expect(typeof createMock).toBe("function");
  });
});
