import { ChatOpenAI } from "@langchain/openai";
import { DEFAULT_MUSE_BASE_URL, loadConfig, type EnvMap } from "../../config.ts";
import type { AdapterSpec, ReasoningEffort } from "./types.ts";

export { DEFAULT_MUSE_BASE_URL };
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Muse Spark 400s on reasoning_effort=none. Map to low so specialists still hit Completions. */
export function museReasoningEffort(effort: ReasoningEffort): ReasoningEffort {
  return effort === "none" ? "low" : effort;
}

export function isMetaSparkHost(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === "api.meta.ai" || host.endsWith(".meta.ai");
  } catch {
    return false;
  }
}

export function isLoopbackMuseUrl(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

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

/**
 * Meta Muse Glimmer: OpenAI-compatible Completions on a local server (llama.cpp / LM Studio / vLLM).
 * Not Microsoft Muse WHAM. Hosted Spark at api.meta.ai is opt-in via MUSE_BASE_URL.
 */
export function createMuseChatModel(spec: AdapterSpec, env: EnvMap): ChatOpenAI {
  const cfg = loadConfig(env);
  const spark = isMetaSparkHost(cfg.museBaseUrl);
  if (spark && !cfg.museApiKey) {
    throw new Error("MODEL_API_KEY or MUSE_API_KEY is required for hosted Muse Spark (tests must setCreateChatModel)");
  }
  const effort = spark ? museReasoningEffort(spec.effort) : spec.effort;
  return createCompatChatModel(
    { ...spec, effort },
    {
      apiKey: cfg.museApiKey ?? "local",
      baseURL: cfg.museBaseUrl,
      useResponsesApi: false,
      mapCompletionsEffort: spark,
    },
  );
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
