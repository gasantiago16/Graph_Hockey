import type { PlayerId } from "../types/ids.ts";
import { DT } from "./rink.ts";
import { isGoalie, type WorldState } from "./world.ts";

/** Auto-change when on-ice fatigue exceeds this, unless lockLines. */
export const FATIGUE_CHANGE_THRESHOLD = 0.65;
/** Typical shift length; also triggers auto-change. */
export const SHIFT_TARGET_SECONDS = 42;
export const BENCH_RECOVER_SECONDS = 40;

export function onIceFatigueDelta(dt: number, stamina: number): number {
  return dt / (25 + stamina / 5);
}

export function benchFatigueDelta(dt: number): number {
  return dt / BENCH_RECOVER_SECONDS;
}

export function tickFatigue(world: WorldState, dt: number = DT): void {
  const ice = new Set<PlayerId>([...world.onIce.home, ...world.onIce.away]);
  for (const id of Object.keys(world.bodies)) {
    const stamina = world.bodies[id]?.attributes?.stamina ?? 50;
    const f = world.fatigue[id] ?? 0;
    const shift = world.shiftTime[id] ?? 0;
    if (ice.has(id)) {
      world.fatigue[id] = Math.min(1, f + onIceFatigueDelta(dt, stamina));
      world.shiftTime[id] = shift + dt;
    } else {
      world.fatigue[id] = Math.max(0, f - benchFatigueDelta(dt));
      world.shiftTime[id] = 0;
    }
  }
}

export function wantsAutoChange(world: WorldState, id: PlayerId, lockLines: boolean): boolean {
  if (lockLines) return false;
  const body = world.bodies[id];
  if (!body || isGoalie(body) || body.line === "F4") return false;
  const f = world.fatigue[id] ?? 0;
  const shift = world.shiftTime[id] ?? 0;
  return f > FATIGUE_CHANGE_THRESHOLD || shift >= SHIFT_TARGET_SECONDS;
}
