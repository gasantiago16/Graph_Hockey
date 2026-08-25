import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { z } from "zod";
import { aarLlm } from "../llm/client.ts";
import type { TeamLlmProfile } from "../llm/profiles.ts";

export type AarLlmOpts = { noLlm?: boolean; profile?: TeamLlmProfile };

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

/**
 * `.withStructuredOutput` first; FakeListChatModel may only return JSON text,
 * so fall back to parsing `invoke` content. Retry once across both paths.
 */
export async function invokeAarStructured<T>(
  schema: z.ZodType<T>,
  system: string,
  user: string,
  profile?: TeamLlmProfile,
): Promise<T | undefined> {
  const messages = [new SystemMessage(system), new HumanMessage(user)];
  for (let attempt = 0; attempt < 2; attempt++) {
    const llm = aarLlm(process.env, profile);
    try {
      const raw: unknown = await llm.withStructuredOutput(schema).invoke(messages);
      const parsed = schema.safeParse(raw);
      if (parsed.success) return parsed.data;
    } catch {
      /* continue to JSON content */
    }
    try {
      const msg = await llm.invoke(messages);
      const parsed = schema.safeParse(JSON.parse(contentText(msg.content)));
      if (parsed.success) return parsed.data;
    } catch {
      continue;
    }
  }
  return undefined;
}
