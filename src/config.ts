import { DT, OT_SECONDS, PERIOD_SECONDS } from "./engine/rink.ts";

export type EnvMap = Record<string, string | undefined>;

export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MUSE_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_COACH_MODEL = "grok-4.5";
export const DEFAULT_FAST_MODEL = "grok-4.3";
export const DEFAULT_AAR_MODEL = "grok-4.5";
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 8787;
export const LANGSMITH_PROJECT = "graph-hockey";

export type AppConfig = {
  xaiApiKey: string | undefined;
  xaiBaseUrl: string;
  openaiApiKey: string | undefined;
  openaiBaseUrl: string;
  museApiKey: string | undefined;
  museBaseUrl: string;
  geminiApiKey: string | undefined;
  coachModel: string;
  fastModel: string;
  aarModel: string;
  hitl: boolean;
  maxPromptTokensPerGame: number;
  maxOutputTokensPerGame: number;
  maxUsdPerGame: number;
  maxCallsPerTeam: number;
  epochTimeoutMs: number;
  httpHost: string;
  httpPort: number;
  langsmithTracing: boolean;
  /** Regulation period length. `GRAPH_HOCKEY_PERIOD_SECONDS=5` keeps CI off 36,000 ticks. */
  periodSeconds: number;
  otSeconds: number;
};

function readString(env: EnvMap, key: string): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readStringOr(env: EnvMap, key: string, fallback: string): string {
  return readString(env, key) ?? fallback;
}

function readInt(env: EnvMap, key: string, fallback: number): number {
  const raw = readString(env, key);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readFloat(env: EnvMap, key: string, fallback: number): number {
  const raw = readString(env, key);
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readPositiveFloat(env: EnvMap, key: string, fallback: number): number {
  const n = readFloat(env, key, fallback);
  return n > 0 ? n : fallback;
}

/** When regulation is shortened, OT scales as 5:00 / 20:00 unless `GRAPH_HOCKEY_OT_SECONDS` is set. */
export function scaledOtSeconds(periodSeconds: number, otOverride?: number): number {
  if (otOverride !== undefined && otOverride > 0) return otOverride;
  if (periodSeconds === PERIOD_SECONDS) return OT_SECONDS;
  return Math.max(DT, periodSeconds * (OT_SECONDS / PERIOD_SECONDS));
}

/** Turns LangSmith on when a key is present. Never required to boot. */
export function applyLangsmithFromEnv(env: EnvMap = process.env): boolean {
  const langsmithKey = readString(env, "LANGSMITH_API_KEY") ?? readString(env, "LANGCHAIN_API_KEY");
  if (!langsmithKey) {
    return false;
  }
  env.LANGSMITH_TRACING = "true";
  env.LANGSMITH_API_KEY = langsmithKey;
  if (!readString(env, "LANGSMITH_PROJECT")) {
    env.LANGSMITH_PROJECT = LANGSMITH_PROJECT;
  }
  return true;
}

/** Reads env with defaults. Missing vendor keys is fine (CI / --no-llm). */
export function loadConfig(env: EnvMap = process.env): AppConfig {
  const langsmithTracing = applyLangsmithFromEnv(env);
  const periodSeconds = readPositiveFloat(env, "GRAPH_HOCKEY_PERIOD_SECONDS", PERIOD_SECONDS);
  const otOverride = readString(env, "GRAPH_HOCKEY_OT_SECONDS");
  const otParsed = otOverride !== undefined ? Number.parseFloat(otOverride) : undefined;
  const otSeconds = scaledOtSeconds(
    periodSeconds,
    otParsed !== undefined && Number.isFinite(otParsed) ? otParsed : undefined,
  );
  return {
    xaiApiKey: readString(env, "XAI_API_KEY"),
    xaiBaseUrl: readStringOr(env, "XAI_BASE_URL", DEFAULT_XAI_BASE_URL),
    openaiApiKey: readString(env, "OPENAI_API_KEY"),
    openaiBaseUrl: readStringOr(env, "OPENAI_BASE_URL", DEFAULT_OPENAI_BASE_URL),
    museApiKey: readString(env, "MODEL_API_KEY") ?? readString(env, "MUSE_API_KEY"),
    museBaseUrl: readStringOr(env, "MUSE_BASE_URL", DEFAULT_MUSE_BASE_URL),
    geminiApiKey: readString(env, "GEMINI_API_KEY") ?? readString(env, "GOOGLE_API_KEY"),
    coachModel: readStringOr(env, "GRAPH_HOCKEY_COACH_MODEL", DEFAULT_COACH_MODEL),
    fastModel: readStringOr(env, "GRAPH_HOCKEY_FAST_MODEL", DEFAULT_FAST_MODEL),
    aarModel: readStringOr(env, "GRAPH_HOCKEY_AAR_MODEL", DEFAULT_AAR_MODEL),
    hitl: readStringOr(env, "GRAPH_HOCKEY_HITL", "0") === "1",
    maxPromptTokensPerGame: readInt(env, "GRAPH_HOCKEY_MAX_PROMPT_TOKENS_PER_GAME", 900_000),
    maxOutputTokensPerGame: readInt(env, "GRAPH_HOCKEY_MAX_OUTPUT_TOKENS_PER_GAME", 250_000),
    maxUsdPerGame: readFloat(env, "GRAPH_HOCKEY_MAX_USD_PER_GAME", 4.0),
    maxCallsPerTeam: readInt(env, "GRAPH_HOCKEY_MAX_CALLS_PER_TEAM", 150),
    epochTimeoutMs: readInt(env, "GRAPH_HOCKEY_EPOCH_TIMEOUT_MS", 12_000),
    httpHost: readStringOr(env, "GRAPH_HOCKEY_HTTP_HOST", DEFAULT_HTTP_HOST),
    httpPort: readInt(env, "GRAPH_HOCKEY_HTTP_PORT", DEFAULT_HTTP_PORT),
    langsmithTracing,
    periodSeconds,
    otSeconds,
  };
}
