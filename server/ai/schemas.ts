import { z } from "zod";

export const WideScanSchema = z.object({
  keywords: z.array(z.string()).min(3).max(7),
  summary: z.string().min(50).max(500),
});
export type WideScanOutput = z.infer<typeof WideScanSchema>;

export const GapDetectionSchema = z.object({
  gaps: z.array(z.object({
    title: z.string(),
    description: z.string(),
  })).min(2).max(5),
  competitors: z.array(z.object({
    name: z.string(),
    weakness: z.string(),
  })).min(2).max(5),
  summary: z.string().min(50).max(500),
});
export type GapDetectionOutput = z.infer<typeof GapDetectionSchema>;

export const DeepDivesSchema = z.object({
  monetizationModels: z.array(z.object({
    name: z.string(),
    description: z.string(),
    revenueEstimate: z.string().optional(),
  })).min(2).max(5),
  technicalChallenges: z.array(z.object({
    title: z.string(),
    severity: z.enum(["low", "medium", "high"]),
  })).min(2).max(5),
  summary: z.string().min(50).max(500),
});
export type DeepDivesOutput = z.infer<typeof DeepDivesSchema>;

export const SynthesisSchema = z.object({
  verdict: z.enum(["GO", "KILL", "CONDITIONAL"]),
  synthesisScore: z.number().min(0).max(10),
  scores: z.object({
    marketSize:   z.number().min(0).max(10),
    competition:  z.number().min(0).max(10),
    feasibility:  z.number().min(0).max(10),
    monetization: z.number().min(0).max(10),
    timeliness:   z.number().min(0).max(10),
  }),
  reportMarkdown: z.string().min(4000),
  verdictReason: z.string().min(50).max(500),
});
export type SynthesisOutput = z.infer<typeof SynthesisSchema>;

export const PollingSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    type: z.enum(["single_choice", "multiple_choice", "likert", "short_text"]),
    text: z.string(),
    options: z.array(z.string()).optional(),
  })).min(3).max(5),
});
export type PollingOutput = z.infer<typeof PollingSchema>;

export const BrainstormSchema = z.object({
  ideas: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().max(300),
  })).length(10),
});
export type BrainstormOutput = z.infer<typeof BrainstormSchema>;
