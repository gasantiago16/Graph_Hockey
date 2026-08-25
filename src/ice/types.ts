import type { PlayerId } from "../types/ids.ts";
import type { Vec2 } from "../types/hockey.ts";

export const ICE_ROLES = ["F1", "F2", "F3", "Ds", "Dw", "G"] as const;
export type IceRole = (typeof ICE_ROLES)[number];

export type IceIntent = {
  roles: Partial<Record<PlayerId, IceRole>>;
  targets: Partial<Record<PlayerId, Vec2>>;
  f1?: PlayerId;
};
