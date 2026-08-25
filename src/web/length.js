/** Period length helpers. OT scale matches engine: 5:00 OT / 20:00 period. */

export const PERIOD_SECONDS_MIN = 1;
export const PERIOD_SECONDS_MAX = 1200;
export const NHL_PERIOD_SECONDS = 1200;
export const NHL_OT_SECONDS = 300;

export const LENGTH_PRESETS = {
  watchable: 15,
  min5: 300,
  min10: 600,
  min20: 1200,
};

export function clampPeriodSeconds(n) {
  if (!Number.isFinite(n) || n <= 0) return LENGTH_PRESETS.watchable;
  return Math.min(PERIOD_SECONDS_MAX, Math.max(PERIOD_SECONDS_MIN, n));
}

export function periodSecondsFromCustom(value, unit) {
  const raw = unit === "min" ? value * 60 : value;
  return clampPeriodSeconds(raw);
}

export function scaledOtSecondsUi(periodSeconds) {
  const p = clampPeriodSeconds(periodSeconds);
  if (p === NHL_PERIOD_SECONDS) return NHL_OT_SECONDS;
  return Math.max(0.1, p * (NHL_OT_SECONDS / NHL_PERIOD_SECONDS));
}

export function formatDurationShort(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (s < 60) {
    const rounded = Math.round(s * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
  }
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function formatPeriodTriple(periodSeconds) {
  const p = clampPeriodSeconds(periodSeconds);
  const ot = scaledOtSecondsUi(p);
  return `3×${formatDurationShort(p)} + OT ${formatDurationShort(ot)}`;
}

export function formatLengthHelp(periodSeconds) {
  const p = clampPeriodSeconds(periodSeconds);
  const core = formatPeriodTriple(p);
  return p <= 30 ? `${core} · demo` : core;
}

export function llmLengthWarning(periodSeconds, useLlm) {
  if (!useLlm) return undefined;
  if (clampPeriodSeconds(periodSeconds) < 300) return undefined;
  return "Live benches will call models for all 3 periods.";
}

export function parseLengthPreset(raw) {
  if (raw === "custom") return "custom";
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return clampPeriodSeconds(n);
}
