import { ChatOpenAI } from "@langchain/openai";
import { DEFAULT_MUSE_BASE_URL, loadConfig, type EnvMap } from "../../config.ts";
import type { AdapterSpec, ReasoningEffort } from "./types.ts";

export { DEFAULT_MUSE_BASE_URL };
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
/** Local Glimmer ~36 tok/s. 120 tokens + prompt stays inside the 6s coach HTTP timeout. */
export const GLIMMER_MAX_TOKENS = 120;

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

function glimmerStructuredKwargs(): Record<string, unknown> {
  return {
    reasoning: "off",
    chat_template_kwargs: { reasoning_strength: "none" },
  };
}

function createCompatChatModel(
  spec: AdapterSpec,
  opts: {
    apiKey: string;
    baseURL: string;
    useResponsesApi: boolean;
    mapCompletionsEffort: boolean;
    extraKwargs?: Record<string, unknown>;
  },
): ChatOpenAI {
  const modelKwargs = opts.mapCompletionsEffort
    ? { reasoning_effort: spec.effort, ...opts.extraKwargs }
    : opts.extraKwargs;
  return new ChatOpenAI({
    model: spec.model,
    apiKey: opts.apiKey,
    temperature: spec.temperature,
    maxTokens: spec.maxTokens,
    timeout: spec.timeoutMs,
    maxRetries: spec.maxRetries,
    configuration: { baseURL: opts.baseURL },
    useResponsesApi: opts.useResponsesApi,
    modelKwargs,
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
  const maxTokens = spark ? spec.maxTokens : Math.min(spec.maxTokens, GLIMMER_MAX_TOKENS);
  return createCompatChatModel(
    { ...spec, effort, maxTokens },
    {
      apiKey: cfg.museApiKey ?? "local",
      baseURL: cfg.museBaseUrl,
      useResponsesApi: false,
      mapCompletionsEffort: spark,
      extraKwargs: spark ? undefined : glimmerStructuredKwargs(),
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
