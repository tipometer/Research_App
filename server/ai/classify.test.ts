import { describe, it, expect } from "vitest";
import { classifyDomain } from "./classify";

describe("classifyDomain", () => {
  it("classifies .edu as academic", () => {
    expect(classifyDomain("https://stanford.edu/research/paper")).toBe("academic");
  });
  it("classifies .ac.uk as academic", () => {
    expect(classifyDomain("https://ox.ac.uk/article")).toBe("academic");
  });
  it("classifies arxiv as academic", () => {
    expect(classifyDomain("https://arxiv.org/abs/2301.12345")).toBe("academic");
  });
  it("classifies reuters as news", () => {
    expect(classifyDomain("https://www.reuters.com/tech/article")).toBe("news");
  });
  it("classifies techcrunch as news", () => {
    expect(classifyDomain("https://techcrunch.com/startup-news")).toBe("news");
  });
  it("classifies reddit as community", () => {
    expect(classifyDomain("https://www.reddit.com/r/startups")).toBe("community");
  });
  it("classifies hackernews as community", () => {
    expect(classifyDomain("https://news.ycombinator.com/item?id=123")).toBe("community");
  });
  it("classifies gartner as industry", () => {
    expect(classifyDomain("https://www.gartner.com/report")).toBe("industry");
  });
  it("classifies statista as industry", () => {
    expect(classifyDomain("https://www.statista.com/chart")).toBe("industry");
  });
  it("defaults to blog for unknown domain", () => {
    expect(classifyDomain("https://somerandomblog.example.com/post")).toBe("blog");
  });
  it("returns blog for invalid URL", () => {
    expect(classifyDomain("not a url")).toBe("blog");
  });
  it("handles URLs without protocol", () => {
    expect(classifyDomain("stanford.edu/research")).toBe("blog");
  });
});
