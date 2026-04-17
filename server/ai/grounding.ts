import { classifyDomain, type SourceType } from "./classify";

export interface GroundingMetadata {
  groundingChunks: Array<{ web: { uri: string; title: string } }>;
  groundingSupports: Array<{
    segment: { text: string; startIndex: number; endIndex: number };
    groundingChunkIndices: number[];
  }>;
  webSearchQueries: string[];
}

export interface ExtractedSource {
  url: string;
  title: string;
  snippet: string;
  sourceType: SourceType;
  publishedAt: null;
}

export function extractOriginalUrl(redirectUrl: string): string {
  const match = redirectUrl.match(/grounding-api-redirect\/(.+)/);
  if (match) {
    try {
      let decoded = Buffer.from(match[1], "base64").toString("utf-8");
      if (decoded.includes("%")) {
        try { decoded = decodeURIComponent(decoded); } catch { /* stay as-is */ }
      }
      if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
        return decoded;
      }
    } catch {
      // base64 decode failed — signed token, fall through
    }
  }
  return redirectUrl;
}

export function extractSources(metadata: GroundingMetadata | null | undefined): ExtractedSource[] {
  if (!metadata) return [];
  const chunks = metadata.groundingChunks ?? [];
  const supports = metadata.groundingSupports ?? [];
  if (chunks.length === 0) {
    // Log the raw shape for diagnostic purposes when we expected chunks but got none.
    // Helps when providers (v6 @ai-sdk/google) change the metadata structure.
    if (process.env.DEBUG_GROUNDING === "1") {
      console.warn("[grounding] No chunks found. Raw shape:", JSON.stringify(metadata).slice(0, 800));
    }
    return [];
  }
  return chunks.map((chunk, idx) => {
    const url = extractOriginalUrl(chunk.web.uri);
    return {
      url,
      title: chunk.web.title,
      snippet: supports
        .filter(s => s.groundingChunkIndices.includes(idx))
        .map(s => s.segment.text)
        .join(" … "),
      sourceType: classifyDomain(url),
      publishedAt: null,
    };
  });
}
