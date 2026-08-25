import { loadConfig, type AppConfig, type EnvMap } from "../config.ts";
import { PROVIDER_IDS, type ProviderId } from "../types/provider.ts";

export { PROVIDER_IDS, ProviderIdSchema, type ProviderId } from "../types/provider.ts";

export type TeamLlmProfile = {
  provider: ProviderId;
  coach: string;
  fast: string;
  aar: string;
};

export const DEFAULT_MUSE_MODEL = "muse-spark-1.2";
export const DEFAULT_OPENAI_COACH = "gpt-5.6-sol";
export const DEFAULT_OPENAI_FAST = "gpt-5.6-luna";
export const DEFAULT_GEMINI_COACH = "gemini-3.1-pro-preview";
export const DEFAULT_GEMINI_FAST = "gemini-3.7-flash";

/** Pinned 2026-08-25. Never default muse-spark-1.2-contributor (prompts used for training). */
export const DEFAULT_PROFILES: Record<ProviderId, TeamLlmProfile> = {
  xai: { provider: "xai", coach: "grok-4.5", fast: "grok-4.3", aar: "grok-4.5" },
  muse: { provider: "muse", coach: DEFAULT_MUSE_MODEL, fast: DEFAULT_MUSE_MODEL, aar: DEFAULT_MUSE_MODEL },
  openai: { provider: "openai", coach: DEFAULT_OPENAI_COACH, fast: DEFAULT_OPENAI_FAST, aar: DEFAULT_OPENAI_COACH },
  gemini: { provider: "gemini", coach: DEFAULT_GEMINI_COACH, fast: DEFAULT_GEMINI_FAST, aar: DEFAULT_GEMINI_COACH },
};

export function parseProviderId(raw: string): ProviderId {
  const id = raw.trim().toLowerCase();
  if ((PROVIDER_IDS as readonly string[]).includes(id)) return id as ProviderId;
  throw new Error(`unknown provider '${raw}' (expected ${PROVIDER_IDS.join("|")})`);
}

export function refuseContributorTier(model: string): string {
  if (/contributor/i.test(model)) {
    throw new Error(
      `refused model '${model}': muse-spark-*-contributor uses prompts for training. Use ${DEFAULT_MUSE_MODEL}.`,
    );
  }
  return model;
}

export function canonicalizeModel(provider: ProviderId, model: string): string {
  const m = refuseContributorTier(model.trim());
  if (provider === "openai" && m === "gpt-5.6") return DEFAULT_OPENAI_COACH;
  return m;
}

export function defaultProfile(provider: ProviderId, env?: EnvMap): TeamLlmProfile {
  if (provider === "xai" && env) {
    const cfg = loadConfig(env);
    return { provider: "xai", coach: cfg.coachModel, fast: cfg.fastModel, aar: cfg.aarModel };
  }
  return { ...DEFAULT_PROFILES[provider] };
}

export type ResolveTeamProfileOpts = {
  provider?: string;
  coach?: string;
  fast?: string;
  aar?: string;
  env?: EnvMap;
};

export function resolveTeamProfile(opts: ResolveTeamProfileOpts = {}): TeamLlmProfile {
  const provider = opts.provider ? parseProviderId(opts.provider) : "xai";
  const base = defaultProfile(provider, opts.env);
  return {
    provider,
    coach: canonicalizeModel(provider, opts.coach ?? base.coach),
    fast: canonicalizeModel(provider, opts.fast ?? base.fast),
    aar: canonicalizeModel(provider, opts.aar ?? base.aar),
  };
}

/** Match-control path: xAI slugs follow GRAPH_HOCKEY_* from the already-loaded config. */
export function profileFromConfig(
  config: Pick<AppConfig, "coachModel" | "fastModel" | "aarModel">,
  provider?: string,
  coach?: string,
): TeamLlmProfile {
  const p = resolveTeamProfile({ provider, coach });
  if (p.provider === "xai" && !coach) {
    return { provider: "xai", coach: config.coachModel, fast: config.fastModel, aar: config.aarModel };
  }
  return p;
}

export function providerApiKey(provider: ProviderId, env: EnvMap = process.env): string | undefined {
  const cfg = loadConfig(env);
  switch (provider) {
    case "xai":
      return cfg.xaiApiKey;
    case "muse":
      return cfg.museApiKey;
    case "openai":
      return cfg.openaiApiKey;
    case "gemini":
      return cfg.geminiApiKey;
  }
}

export function providerKeyPresent(provider: ProviderId, env: EnvMap = process.env): boolean {
  return Boolean(providerApiKey(provider, env));
}

export function providersHaveKeys(home: ProviderId, away: ProviderId, env: EnvMap = process.env): boolean {
  return providerKeyPresent(home, env) && providerKeyPresent(away, env);
}

export function missingProviderKeys(home: ProviderId, away: ProviderId, env: EnvMap = process.env): ProviderId[] {
  const need = [...new Set([home, away])];
  return need.filter((p) => !providerKeyPresent(p, env));
}

export function providerPresence(env: EnvMap = process.env): Record<ProviderId, boolean> {
  return {
    xai: providerKeyPresent("xai", env),
    muse: providerKeyPresent("muse", env),
    openai: providerKeyPresent("openai", env),
    gemini: providerKeyPresent("gemini", env),
  };
}

export function presenceFromConfig(
  config: Pick<AppConfig, "xaiApiKey" | "museApiKey" | "openaiApiKey" | "geminiApiKey">,
): Record<ProviderId, boolean> {
  return {
    xai: Boolean(config.xaiApiKey),
    muse: Boolean(config.museApiKey),
    openai: Boolean(config.openaiApiKey),
    gemini: Boolean(config.geminiApiKey),
  };
}

export function configHasProviderKey(
  config: Pick<AppConfig, "xaiApiKey" | "museApiKey" | "openaiApiKey" | "geminiApiKey">,
  provider: ProviderId,
): boolean {
  return presenceFromConfig(config)[provider];
}

export function formatBenchLabel(profile: Pick<TeamLlmProfile, "provider" | "coach">): string {
  return `${profile.provider}/${profile.coach}`;
}

export function formatBenchHud(home: Pick<TeamLlmProfile, "provider" | "coach">, away: Pick<TeamLlmProfile, "provider" | "coach">): string {
  return `home: ${formatBenchLabel(home)} vs away: ${formatBenchLabel(away)}`;
}

export type TeamLlmOpts = {
  noLlm?: boolean;
  profile?: TeamLlmProfile;
};
