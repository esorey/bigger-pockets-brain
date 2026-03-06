import { describe, expect, test } from "bun:test";
import {
  CLIError,
  formatSearchResults,
  parseSearchCommandOptions,
} from "../../src/cli";
import type { SearchResult } from "../../src/types";

describe("parseSearchCommandOptions", () => {
  test("parses plain query with defaults", () => {
    const options = parseSearchCommandOptions(["house", "hacking"]);
    expect(options).toEqual({
      query: "house hacking",
      limit: 10,
      verbose: false,
      layer: "both",
    });
  });

  test("parses options and query in mixed order", () => {
    const options = parseSearchCommandOptions([
      "--limit",
      "5",
      "nurse",
      "quit",
      "--verbose",
      "--layer",
      "chunk",
    ]);

    expect(options).toEqual({
      query: "nurse quit",
      limit: 5,
      verbose: true,
      layer: "chunk",
    });
  });

  test("parses query before options", () => {
    const options = parseSearchCommandOptions([
      "cashflow",
      "deal",
      "--layer",
      "summary",
    ]);

    expect(options).toEqual({
      query: "cashflow deal",
      limit: 10,
      verbose: false,
      layer: "summary",
    });
  });

  test("throws for missing query", () => {
    expect(() => parseSearchCommandOptions(["--limit", "5"])).toThrow(
      new CLIError("Search query required")
    );
  });

  test("throws for invalid limit", () => {
    expect(() =>
      parseSearchCommandOptions(["query", "--limit", "0"])
    ).toThrow(new CLIError("Invalid --limit value: 0"));
  });

  test("throws for invalid layer", () => {
    expect(() =>
      parseSearchCommandOptions(["query", "--layer", "invalid"])
    ).toThrow(new CLIError("Invalid --layer value: invalid"));
  });

  test("throws for unknown option", () => {
    expect(() => parseSearchCommandOptions(["query", "--wat"])).toThrow(
      new CLIError("Unknown search option: --wat")
    );
  });
});

describe("formatSearchResults", () => {
  const sampleResults: SearchResult[] = [
    {
      episodeNumber: 1246,
      title: "$1 Rental Properties",
      publishedAt: new Date("2026-03-01T00:00:00Z"),
      url: "https://example.com/1246",
      matchingSnippet: "quit my nursing job after hitting $4k/month cash flow",
      similarity: 0.92345,
      matchType: "chunk",
    },
  ];

  test("formats regular output without score metadata", () => {
    const output = formatSearchResults(sampleResults);
    expect(output).toContain('1. Episode 1246 - "$1 Rental Properties"');
    expect(output).toContain('→ "quit my nursing job');
    expect(output).not.toContain("score=");
    expect(output).not.toContain("layer=");
  });

  test("formats verbose output with score and layer", () => {
    const output = formatSearchResults(sampleResults, { verbose: true });
    expect(output).toContain("score=0.923");
    expect(output).toContain("layer=chunk");
  });

  test("handles empty results", () => {
    expect(formatSearchResults([])).toBe("No matching episodes found.");
  });
});
