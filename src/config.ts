export type EnvMap = Record<string, string | undefined>;

export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_COACH_MODEL = "grok-4.5";
export const DEFAULT_FAST_MODEL = "grok-4.3";
export const DEFAULT_AAR_MODEL = "grok-4.5";
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 8787;
export const LANGSMITH_PROJECT = "graph-hockey";

export type AppConfig = {
  xaiApiKey: string | undefined;
  xaiBaseUrl: string;
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

/** Reads env with defaults. Missing XAI_API_KEY is fine (CI / --no-llm). */
export function loadConfig(env: EnvMap = process.env): AppConfig {
  const langsmithTracing = applyLangsmithFromEnv(env);
  return {
    xaiApiKey: readString(env, "XAI_API_KEY"),
    xaiBaseUrl: readStringOr(env, "XAI_BASE_URL", DEFAULT_XAI_BASE_URL),
    coachModel: readStringOr(env, "GRAPH_HOCKEY_COACH_MODEL", DEFAULT_COACH_MODEL),
    fastModel: readStringOr(env, "GRAPH_HOCKEY_FAST_MODEL", DEFAULT_FAST_MODEL),
    aarModel: readStringOr(env, "GRAPH_HOCKEY_AAR_MODEL", DEFAULT_AAR_MODEL),
    hitl: readStringOr(env, "GRAPH_HOCKEY_HITL", "0") === "1",
    maxPromptTokensPerGame: readInt(env, "GRAPH_HOCKEY_MAX_PROMPT_TOKENS_PER_GAME", 900_000),
    maxOutputTokensPerGame: readInt(env, "GRAPH_HOCKEY_MAX_OUTPUT_TOKENS_PER_GAME", 250_000),
    maxUsdPerGame: readFloat(env, "GRAPH_HOCKEY_MAX_USD_PER_GAME", 4.0),
    maxCallsPerTeam: readInt(env, "GRAPH_HOCKEY_MAX_CALLS_PER_TEAM", 150),
    epochTimeoutMs: readInt(env, "GRAPH_HOCKEY_EPOCH_TIMEOUT_MS", 8_000),
    httpHost: readStringOr(env, "GRAPH_HOCKEY_HTTP_HOST", DEFAULT_HTTP_HOST),
    httpPort: readInt(env, "GRAPH_HOCKEY_HTTP_PORT", DEFAULT_HTTP_PORT),
    langsmithTracing,
  };
}
