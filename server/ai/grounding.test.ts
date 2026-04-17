import { describe, it, expect } from "vitest";
import { extractOriginalUrl, extractSources, type GroundingMetadata } from "./grounding";

describe("extractOriginalUrl", () => {
  it("decodes base64-encoded redirect payload", () => {
    const original = "https://example.com/article";
    const encoded = Buffer.from(original, "utf-8").toString("base64");
    const redirect = `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${encoded}`;
    expect(extractOriginalUrl(redirect)).toBe(original);
  });
  it("falls back to raw URL when base64 decode fails", () => {
    const signedToken = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc.def.ghi";
    // Not valid base64 content → returned as-is (or at least not a valid http(s) URL after decode)
    expect(extractOriginalUrl(signedToken)).toBe(signedToken);
  });
  it("falls back when decoded result is not a URL", () => {
    const garbage = Buffer.from("not-a-url", "utf-8").toString("base64");
    const redirect = `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${garbage}`;
    expect(extractOriginalUrl(redirect)).toBe(redirect);
  });
  it("returns plain URL unchanged if no redirect prefix", () => {
    const url = "https://example.com/article";
    expect(extractOriginalUrl(url)).toBe(url);
  });
  it("handles percent-encoded decoded URL", () => {
    const original = "https://example.com/article?q=hello world";
    const encoded = Buffer.from(encodeURIComponent(original), "utf-8").toString("base64");
    const redirect = `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${encoded}`;
    expect(extractOriginalUrl(redirect)).toBe(original);
  });
});

describe("extractSources", () => {
  it("maps groundingChunks to ExtractedSource with aggregated snippets", () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [
        { web: { uri: "https://example.com/a", title: "Article A" } },
        { web: { uri: "https://stanford.edu/paper", title: "Paper B" } },
      ],
      groundingSupports: [
        {
          segment: { text: "First finding", startIndex: 0, endIndex: 13 },
          groundingChunkIndices: [0],
        },
        {
          segment: { text: "Second finding", startIndex: 20, endIndex: 34 },
          groundingChunkIndices: [0, 1],
        },
      ],
      webSearchQueries: ["q1"],
    };
    const result = extractSources(metadata);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      url: "https://example.com/a",
      title: "Article A",
      snippet: "First finding … Second finding",
      sourceType: "blog",
      publishedAt: null,
    });
    expect(result[1].url).toBe("https://stanford.edu/paper");
    expect(result[1].sourceType).toBe("academic");
    expect(result[1].snippet).toBe("Second finding");
    expect(result[1].publishedAt).toBeNull();
  });

  it("returns empty array when no chunks", () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [],
      groundingSupports: [],
      webSearchQueries: [],
    };
    expect(extractSources(metadata)).toEqual([]);
  });

  it("handles chunks with no supporting segments", () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [{ web: { uri: "https://example.com", title: "A" } }],
      groundingSupports: [],
      webSearchQueries: [],
    };
    const result = extractSources(metadata);
    expect(result[0].snippet).toBe("");
  });
});
