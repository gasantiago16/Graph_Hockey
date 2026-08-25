import type { InspectSide, InspectState } from "../types/ws.ts";

export const PLAY_NAME_HIDDEN = "Play name hidden";

/** HUD fields only. playId stays on the inspect WS message, never in this string. */
export type InspectHudView = Pick<InspectState, "side" | "playName" | "pressure">;

/**
 * Inspect-side play name (home/away/none). Switching sides or `none` never
 * prints the other team's play — callers must only pass that side's InspectState.
 */
export function formatInspectHud(
  inspectSide: InspectSide,
  inspect?: InspectHudView | null,
): string {
  if (inspectSide === "none" || inspect == null) return PLAY_NAME_HIDDEN;
  if (inspect.side !== inspectSide) return PLAY_NAME_HIDDEN;
  return `${inspect.side} · ${inspect.playName} (${inspect.pressure})`;
}
