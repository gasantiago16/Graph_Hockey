import { ChatXAI, type ChatXAIInput } from "@langchain/xai";
import { loadConfig, type EnvMap } from "../../config.ts";
import type { AdapterSpec, ReasoningEffort } from "./types.ts";

type ChatXaiFields = Omit<ChatXAIInput, "model"> & {
  timeout?: number;
  maxRetries?: number;
  modelKwargs?: { reasoning_effort?: ReasoningEffort };
};

/**
 * Two-arg Completions constructor. Completions body field is modelKwargs.reasoning_effort.
 * Do not pass reasoning_effort via withConfig — it is not a ChatXAICallOptions key.
 * Do not silently point ChatOpenAI at api.x.ai.
 */
export function createXaiChatModel(spec: AdapterSpec, env: EnvMap): ChatXAI {
  const cfg = loadConfig(env);
  if (!cfg.xaiApiKey) {
    throw new Error("XAI_API_KEY is required for live ChatXAI (tests must setCreateChatModel)");
  }
  return new ChatXAI(spec.model, {
    apiKey: cfg.xaiApiKey,
    baseURL: cfg.xaiBaseUrl,
    temperature: spec.temperature,
    maxRetries: spec.maxRetries,
    maxTokens: spec.maxTokens,
    timeout: spec.timeoutMs,
    modelKwargs: { reasoning_effort: spec.effort },
  } as ChatXaiFields);
}
