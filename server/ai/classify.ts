export type SourceType = "academic" | "industry" | "news" | "blog" | "community";

const ACADEMIC_TLDS = [".edu", ".ac.uk", ".ac.hu"];
const ACADEMIC_DOMAINS = [
  "scholar.google.com",
  "pubmed.ncbi.nlm.nih.gov",
  "arxiv.org",
  "researchgate.net",
];

const NEWS_DOMAINS = [
  "bbc.com", "reuters.com", "techcrunch.com", "forbes.com",
  "bloomberg.com", "wsj.com", "ft.com", "nytimes.com",
  "theguardian.com", "cnn.com", "theverge.com", "arstechnica.com",
];

const COMMUNITY_DOMAINS = [
  "reddit.com", "quora.com", "stackoverflow.com",
  "producthunt.com", "news.ycombinator.com", "medium.com",
];

const INDUSTRY_DOMAINS = [
  "gartner.com", "mckinsey.com", "statista.com",
  "crunchbase.com", "pitchbook.com", "forrester.com",
  "idc.com", "deloitte.com", "kpmg.com", "pwc.com",
];

function safeParseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function classifyDomain(url: string): SourceType {
  const host = safeParseHost(url);
  if (!host) return "blog";

  if (ACADEMIC_TLDS.some(tld => host.endsWith(tld))) return "academic";
  if (ACADEMIC_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "academic";
  if (NEWS_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "news";
  if (COMMUNITY_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "community";
  if (INDUSTRY_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "industry";
  return "blog";
}
