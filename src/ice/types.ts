import type { PlayerId } from "../types/ids.ts";
import type { Vec2 } from "../types/hockey.ts";

export const ICE_ROLES = ["F1", "F2", "F3", "Ds", "Dw", "G"] as const;
export type IceRole = (typeof ICE_ROLES)[number];

export const ICE_F1_ACTIONS = ["hunt", "pass", "shoot", "clear"] as const;
export type IceF1Action = (typeof ICE_F1_ACTIONS)[number];

export type IceIntent = {
  roles: Partial<Record<PlayerId, IceRole>>;
  targets: Partial<Record<PlayerId, Vec2>>;
  f1?: PlayerId;
  /** F1 with the puck: OZ shoot, NZ pass, DZ clear. Loose puck: hunt. */
  f1Action?: IceF1Action;
};
