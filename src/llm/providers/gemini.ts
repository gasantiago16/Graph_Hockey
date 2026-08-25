import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { loadConfig, type EnvMap } from "../../config.ts";
import type { AdapterSpec, ReasoningEffort } from "./types.ts";

function thinkingConfig(effort: ReasoningEffort): ChatGoogleGenerativeAI["thinkingConfig"] {
  if (effort === "none") return undefined;
  if (effort === "low") return { thinkingLevel: "LOW" };
  if (effort === "medium") return { thinkingLevel: "MEDIUM" };
  return { thinkingLevel: "HIGH" };
}

export function createGeminiChatModel(spec: AdapterSpec, env: EnvMap): ChatGoogleGenerativeAI {
  const cfg = loadConfig(env);
  if (!cfg.geminiApiKey) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required for live Gemini (tests must setCreateChatModel)");
  }
  return new ChatGoogleGenerativeAI({
    model: spec.model,
    apiKey: cfg.geminiApiKey,
    temperature: spec.temperature,
    maxOutputTokens: spec.maxTokens,
    maxRetries: spec.maxRetries,
    thinkingConfig: thinkingConfig(spec.effort),
  });
}
