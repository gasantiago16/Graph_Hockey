import { ChatXAI, type ChatXAIInput } from "@langchain/xai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  DEFAULT_AAR_MODEL,
  DEFAULT_COACH_MODEL,
  DEFAULT_FAST_MODEL,
  loadConfig,
  type EnvMap,
} from "../config.ts";

export type ReasoningEffort = "none" | "low" | "medium" | "high";
export type ChatModelKind = "coach" | "fast" | "aar";
export type CreateChatModel = (kind: ChatModelKind) => BaseChatModel;

export const COACH_TIMEOUT_MS = 5_000;
export const FAST_TIMEOUT_MS = 2_500;
export const AAR_TIMEOUT_MS = 60_000;
export const COACH_MAX_TOKENS = 1_600;
export const FAST_MAX_TOKENS = 500;
export const AAR_MAX_TOKENS = 3_000;
export const LLM_TEMPERATURE = 0.2;
export const LLM_MAX_RETRIES = 2;

type ChatXaiFields = Omit<ChatXAIInput, "model"> & {
  timeout?: number;
  maxRetries?: number;
  modelKwargs?: { reasoning_effort?: ReasoningEffort };
};

let injected: CreateChatModel | undefined;
let fastEffort: ReasoningEffort = "none";

export function setCreateChatModel(factory: CreateChatModel | undefined): void {
  injected = factory;
}

export function hasInjectedChatModel(): boolean {
  return injected !== undefined;
}

/** Restores inject + grok-4.3 `none` after tests that call `markReasoningNoneUnsupported`. */
export function resetLlmClientForTests(): void {
  injected = undefined;
  fastEffort = "none";
}

export function hasXaiApiKey(env: EnvMap = process.env): boolean {
  return loadConfig(env).xaiApiKey !== undefined;
}

export function isXaiHttp400(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as {
    status?: number;
    statusCode?: number;
    message?: string;
    error?: { status?: number; code?: number };
  };
  if (rec.status === 400 || rec.statusCode === 400 || rec.error?.status === 400) return true;
  return typeof rec.message === "string" && /\b400\b/.test(rec.message);
}

/**
 * grok-4.3 `reasoning_effort=none` may 400. Smoke catches that, logs this, and retries `low`.
 */
export function markReasoningNoneUnsupported(): void {
  if (fastEffort === "none") {
    console.warn("ReasoningNoneUnsupported");
    fastEffort = "low";
  }
}

export type ChatModelSpec = {
  kind: ChatModelKind;
  model: string;
  effort: ReasoningEffort;
  maxTokens: number;
  timeoutMs: number;
  temperature: number;
  maxRetries: number;
};

export function chatModelSpec(kind: ChatModelKind, env: EnvMap = process.env): ChatModelSpec {
  const cfg = loadConfig(env);
  if (kind === "coach") {
    return {
      kind,
      model: cfg.coachModel,
      effort: "low",
      maxTokens: COACH_MAX_TOKENS,
      timeoutMs: COACH_TIMEOUT_MS,
      temperature: LLM_TEMPERATURE,
      maxRetries: LLM_MAX_RETRIES,
    };
  }
  if (kind === "aar") {
    return {
      kind,
      model: cfg.aarModel,
      effort: "high",
      maxTokens: AAR_MAX_TOKENS,
      timeoutMs: AAR_TIMEOUT_MS,
      temperature: LLM_TEMPERATURE,
      maxRetries: LLM_MAX_RETRIES,
    };
  }
  return {
    kind,
    model: cfg.fastModel,
    effort: fastEffort,
    maxTokens: FAST_MAX_TOKENS,
    timeoutMs: FAST_TIMEOUT_MS,
    temperature: LLM_TEMPERATURE,
    maxRetries: LLM_MAX_RETRIES,
  };
}

function xai(kind: ChatModelKind, env: EnvMap): ChatXAI {
  const cfg = loadConfig(env);
  if (!cfg.xaiApiKey) {
    throw new Error("XAI_API_KEY is required for live ChatXAI (tests must setCreateChatModel)");
  }
  const spec = chatModelSpec(kind, env);
  // Two-arg Completions constructor. Completions body field is modelKwargs.reasoning_effort.
  // Do not pass reasoning_effort via withConfig — it is not a ChatXAICallOptions key.
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

export function createChatModel(kind: ChatModelKind, env: EnvMap = process.env): BaseChatModel {
  if (injected) return injected(kind);
  return xai(kind, env);
}

export function coachLlm(env: EnvMap = process.env): BaseChatModel {
  return createChatModel("coach", env);
}

export function fastLlm(env: EnvMap = process.env): BaseChatModel {
  return createChatModel("fast", env);
}

export function aarLlm(env: EnvMap = process.env): BaseChatModel {
  return createChatModel("aar", env);
}

export { DEFAULT_AAR_MODEL, DEFAULT_COACH_MODEL, DEFAULT_FAST_MODEL };
