import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  DEFAULT_AAR_MODEL,
  DEFAULT_COACH_MODEL,
  DEFAULT_FAST_MODEL,
  loadConfig,
  type EnvMap,
} from "../config.ts";
import { defaultProfile, type TeamLlmProfile } from "./profiles.ts";
import {
  createGeminiChatModel,
  createMuseChatModel,
  createOpenAiChatModel,
  createXaiChatModel,
  type AdapterSpec,
  type ReasoningEffort,
} from "./providers/index.ts";

export type { ReasoningEffort };
export type ChatModelKind = "coach" | "fast" | "aar";
export type CreateChatModel = (kind: ChatModelKind, profile?: TeamLlmProfile) => BaseChatModel;

export const COACH_TIMEOUT_MS = 5_000;
export const FAST_TIMEOUT_MS = 2_500;
export const AAR_TIMEOUT_MS = 60_000;
export const COACH_MAX_TOKENS = 1_600;
export const FAST_MAX_TOKENS = 500;
export const AAR_MAX_TOKENS = 3_000;
export const LLM_TEMPERATURE = 0.2;
export const LLM_MAX_RETRIES = 2;

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

export function chatModelSpec(
  kind: ChatModelKind,
  env: EnvMap = process.env,
  profile?: TeamLlmProfile,
): ChatModelSpec {
  const cfg = loadConfig(env);
  const model = profile
    ? kind === "coach"
      ? profile.coach
      : kind === "aar"
        ? profile.aar
        : profile.fast
    : kind === "coach"
      ? cfg.coachModel
      : kind === "aar"
        ? cfg.aarModel
        : cfg.fastModel;
  if (kind === "coach") {
    return {
      kind,
      model,
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
      model,
      effort: "high",
      maxTokens: AAR_MAX_TOKENS,
      timeoutMs: AAR_TIMEOUT_MS,
      temperature: LLM_TEMPERATURE,
      maxRetries: LLM_MAX_RETRIES,
    };
  }
  return {
    kind,
    model,
    effort: fastEffort,
    maxTokens: FAST_MAX_TOKENS,
    timeoutMs: FAST_TIMEOUT_MS,
    temperature: LLM_TEMPERATURE,
    maxRetries: LLM_MAX_RETRIES,
  };
}

function toAdapterSpec(spec: ChatModelSpec): AdapterSpec {
  return {
    model: spec.model,
    effort: spec.effort,
    maxTokens: spec.maxTokens,
    timeoutMs: spec.timeoutMs,
    temperature: spec.temperature,
    maxRetries: spec.maxRetries,
  };
}

function liveModel(spec: ChatModelSpec, profile: TeamLlmProfile, env: EnvMap): BaseChatModel {
  const adapter = toAdapterSpec(spec);
  switch (profile.provider) {
    case "xai":
      return createXaiChatModel(adapter, env);
    case "muse":
      return createMuseChatModel(adapter, env);
    case "openai":
      return createOpenAiChatModel(adapter, env);
    case "gemini":
      return createGeminiChatModel(adapter, env);
  }
}

export type CreateChatModelArgs = {
  kind: ChatModelKind;
  profile?: TeamLlmProfile;
  env?: EnvMap;
};

function isCreateArgs(v: unknown): v is CreateChatModelArgs {
  return typeof v === "object" && v !== null && "kind" in v && typeof (v as CreateChatModelArgs).kind === "string";
}

export function createChatModel(kind: ChatModelKind, env?: EnvMap, profile?: TeamLlmProfile): BaseChatModel;
export function createChatModel(args: CreateChatModelArgs): BaseChatModel;
export function createChatModel(
  kindOrArgs: ChatModelKind | CreateChatModelArgs,
  env: EnvMap = process.env,
  profile?: TeamLlmProfile,
): BaseChatModel {
  if (isCreateArgs(kindOrArgs)) {
    return createChatModel(kindOrArgs.kind, kindOrArgs.env ?? process.env, kindOrArgs.profile);
  }
  if (injected) return injected(kindOrArgs, profile);
  const resolved = profile ?? defaultProfile("xai", env);
  const spec = chatModelSpec(kindOrArgs, env, resolved);
  return liveModel(spec, resolved, env);
}

export function coachLlm(env: EnvMap = process.env, profile?: TeamLlmProfile): BaseChatModel {
  return createChatModel("coach", env, profile);
}

export function fastLlm(env: EnvMap = process.env, profile?: TeamLlmProfile): BaseChatModel {
  return createChatModel("fast", env, profile);
}

export function aarLlm(env: EnvMap = process.env, profile?: TeamLlmProfile): BaseChatModel {
  return createChatModel("aar", env, profile);
}

export { DEFAULT_AAR_MODEL, DEFAULT_COACH_MODEL, DEFAULT_FAST_MODEL };
