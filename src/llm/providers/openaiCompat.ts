import { ChatOpenAI } from "@langchain/openai";
import { loadConfig, type EnvMap } from "../../config.ts";
import type { AdapterSpec } from "./types.ts";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MUSE_BASE_URL = "https://api.meta.ai/v1";

function createCompatChatModel(
  spec: AdapterSpec,
  opts: { apiKey: string; baseURL: string; useResponsesApi: boolean; mapCompletionsEffort: boolean },
): ChatOpenAI {
  return new ChatOpenAI({
    model: spec.model,
    apiKey: opts.apiKey,
    temperature: spec.temperature,
    maxTokens: spec.maxTokens,
    timeout: spec.timeoutMs,
    maxRetries: spec.maxRetries,
    configuration: { baseURL: opts.baseURL },
    useResponsesApi: opts.useResponsesApi,
    modelKwargs: opts.mapCompletionsEffort ? { reasoning_effort: spec.effort } : undefined,
  });
}

/** Meta Muse Spark: OpenAI-compatible Completions at api.meta.ai. Not Microsoft Muse WHAM. */
export function createMuseChatModel(spec: AdapterSpec, env: EnvMap): ChatOpenAI {
  const cfg = loadConfig(env);
  if (!cfg.museApiKey) {
    throw new Error("MODEL_API_KEY or MUSE_API_KEY is required for live Muse Spark (tests must setCreateChatModel)");
  }
  return createCompatChatModel(spec, {
    apiKey: cfg.museApiKey,
    baseURL: cfg.museBaseUrl,
    useResponsesApi: false,
    mapCompletionsEffort: true,
  });
}

export function createOpenAiChatModel(spec: AdapterSpec, env: EnvMap): ChatOpenAI {
  const cfg = loadConfig(env);
  if (!cfg.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required for live OpenAI (tests must setCreateChatModel)");
  }
  return createCompatChatModel(spec, {
    apiKey: cfg.openaiApiKey,
    baseURL: cfg.openaiBaseUrl,
    useResponsesApi: true,
    mapCompletionsEffort: false,
  });
}
