export type ReasoningEffort = "none" | "low" | "medium" | "high";

/** Plain data the adapters need. Avoid importing the factory (cycle). */
export type AdapterSpec = {
  model: string;
  effort: ReasoningEffort;
  maxTokens: number;
  timeoutMs: number;
  temperature: number;
  maxRetries: number;
};
