import { SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import { coercePressure } from "../types/hockey.ts";
import { markReasoningNoneUnsupported } from "./client.ts";

export type InvokeStructuredOpts = {
  label?: string;
  signal?: AbortSignal;
  /** Skip the JSON invoke after structured fails (timeout or parse). */
};

/** Visible text only — skip reasoning/tool blocks so JSON parse can see the object. */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (!part || typeof part !== "object") continue;
      const rec = part as Record<string, unknown>;
      const kind = typeof rec.type === "string" ? rec.type : "";
      if (kind === "reasoning" || kind === "thinking" || kind === "tool_use") continue;
      if (typeof rec.text === "string") parts.push(rec.text);
      else if (typeof rec.content === "string") parts.push(rec.content);
    }
    return parts.join("");
  }
  if (content && typeof content === "object") {
    const rec = content as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
  }
  return "";
}

export function parseJsonValue(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export function isTimeoutErr(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as { name?: string; message?: string };
  if (rec.name === "TimeoutError" || rec.name === "AbortError") return true;
  return typeof rec.message === "string" && /timed out|timeout|aborted/i.test(rec.message);
}

function modelName(llm: BaseChatModel): string {
  const rec = llm as BaseChatModel & { model?: unknown };
  return typeof rec.model === "string" ? rec.model : "";
}

/**
 * Muse Completions: LangChain defaults jsonSchema + OpenAI-strict Zod, which 400s
 * on optional fields. json_object is enough; we still Zod-parse the object.
 */
export function structuredMethodForModel(model: string): "jsonMode" | undefined {
  // ChatOpenAI jsonSchema + Zod .optional() 400s on grok/muse/gpt. json_object + Zod parse.
  if (model.startsWith("muse-") || model.startsWith("grok-") || model.startsWith("gpt-")) return "jsonMode";
  return undefined;
}

function logFail(label: string, phase: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`structured:${label}:${phase} ${msg.slice(0, 220)}`);
}

function maybeMarkNone(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (/reasoning_effort/i.test(msg)) markReasoningNoneUnsupported();
}

function outboundMessages(messages: BaseMessage[], jsonObject: boolean): BaseMessage[] {
  if (!jsonObject) return messages;
  return [new SystemMessage("Respond with a JSON object matching the requested schema."), ...messages];
}

function normalizeLlmObject(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const rec = { ...(raw as Record<string, unknown>) };
  if ("pressure" in rec) rec.pressure = coercePressure(rec.pressure);
  if (typeof rec.memo !== "string" && typeof rec.advice === "string") rec.memo = rec.advice;
  return rec;
}

/** jsonMode: do not let LangChain Zod-parse the vendor object (pressure: high 400s the enum). */
const LooseJsonObject = z.object({}).passthrough();

/**
 * Native `.withStructuredOutput` first. JSON invoke is the fallback unless
 * the structured call timed out or `noJsonRetry` is set.
 */
export async function invokeStructured<T>(
  llm: BaseChatModel,
  schema: z.ZodType<T>,
  messages: BaseMessage[],
  opts: InvokeStructuredOpts = {},
): Promise<T | undefined> {
  const label = opts.label ?? "llm";
  const invokeOpts = opts.signal ? { signal: opts.signal } : undefined;
  const method = structuredMethodForModel(modelName(llm));
  const outbound = outboundMessages(messages, method === "jsonMode");

  try {
    const runnable = method
      ? llm.withStructuredOutput(LooseJsonObject, { method })
      : llm.withStructuredOutput(schema);
    const raw: unknown = await runnable.invoke(outbound, invokeOpts);
    const parsed = schema.safeParse(normalizeLlmObject(raw));
    if (parsed.success) return parsed.data;
    console.warn(`structured:${label}:structured parse failed`);
    if (opts.noJsonRetry) return undefined;
  } catch (err) {
    maybeMarkNone(err);
    logFail(label, "structured", err);
    if (isTimeoutErr(err) || opts.noJsonRetry) return undefined;
  }

  try {
    const msg = await llm.invoke(outbound, invokeOpts);
    const parsed = schema.safeParse(normalizeLlmObject(parseJsonValue(extractText(msg.content))));
    if (parsed.success) return parsed.data;
  } catch (err) {
    maybeMarkNone(err);
    logFail(label, "json", err);
  }
  return undefined;
}
