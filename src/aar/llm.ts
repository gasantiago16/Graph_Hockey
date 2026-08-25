import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { z } from "zod";
import { AAR_TIMEOUT_MS, aarLlm } from "../llm/client.ts";
import type { TeamLlmProfile } from "../llm/profiles.ts";
import { invokeStructured } from "../llm/structured.ts";

export type AarLlmOpts = { noLlm?: boolean; profile?: TeamLlmProfile };

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * One structured + JSON-content pass via invokeStructured, raced against timeoutMs.
 * No 2×2 retry (that hung the rink on Muse).
 */
export async function invokeAarStructured<T>(
  schema: z.ZodType<T>,
  system: string,
  user: string,
  profile?: TeamLlmProfile,
  timeoutMs: number = AAR_TIMEOUT_MS,
): Promise<T | undefined> {
  const messages = [new SystemMessage(system), new HumanMessage(user)];
  const llm = aarLlm(process.env, profile);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await withDeadline(
      invokeStructured(llm, schema, messages, { label: "aar", signal }),
      timeoutMs,
      "aar",
    );
  } catch {
    return undefined;
  }
}
