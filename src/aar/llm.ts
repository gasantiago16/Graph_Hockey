import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { z } from "zod";
import { AAR_TIMEOUT_MS, aarLlm } from "../llm/client.ts";
import type { TeamLlmProfile } from "../llm/profiles.ts";

export type AarLlmOpts = { noLlm?: boolean; profile?: TeamLlmProfile };

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

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
 * `.withStructuredOutput` first; FakeListChatModel may only return JSON text,
 * so fall back to parsing `invoke` content. One pass each — no 2×2 retry
 * (that could hang the rink for minutes on Muse/OpenAI).
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
    const raw: unknown = await withDeadline(
      llm.withStructuredOutput(schema).invoke(messages, { signal }),
      timeoutMs,
      "aar-structured",
    );
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch {
    /* JSON content fallback */
  }
  try {
    const msg = await withDeadline(llm.invoke(messages, { signal }), timeoutMs, "aar-json");
    const parsed = schema.safeParse(JSON.parse(contentText(msg.content)));
    if (parsed.success) return parsed.data;
  } catch {
    return undefined;
  }
  return undefined;
}
