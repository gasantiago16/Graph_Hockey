import { afterEach, describe, expect, it, vi } from "vitest";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { CoachIntentSchema } from "./schemas.ts";
import { chatModelSpec, resetLlmClientForTests } from "./client.ts";
import {
  extractMessageText,
  extractText,
  invokeStructured,
  isTimeoutErr,
  parseJsonValue,
  skipNativeStructured,
  structuredMethodForModel,
} from "./structured.ts";

const intent = {
  supposedToHappen: "pass to the slot and shoot",
  playId: "5v5-122-forecheck",
  pressure: "neutral" as const,
};

const messages = [new SystemMessage("coach"), new HumanMessage("faceoff")];

afterEach(() => {
  resetLlmClientForTests();
  vi.restoreAllMocks();
});

function fakeLlm(overrides: {
  structured?: () => Promise<unknown>;
  invoke?: () => Promise<{ content: unknown }>;
  model?: string;
}): BaseChatModel {
  const llm = {
    model: overrides.model,
    withStructuredOutput: () => ({
      invoke: overrides.structured ?? (async () => {
        throw new Error("no structured");
      }),
    }),
    invoke: overrides.invoke ?? (async () => ({ content: "" })),
  };
  return llm as unknown as BaseChatModel;
}

describe("structured helpers", () => {
  it("extracts visible text and skips reasoning blocks", () => {
    expect(extractText("plain")).toBe("plain");
    expect(
      extractText([
        { type: "reasoning", text: "think" },
        { type: "text", text: '{"ok":true}' },
      ]),
    ).toBe('{"ok":true}');
    expect(extractText({ text: "nested" })).toBe("nested");
    expect(extractText(null)).toBe("");
    expect(
      extractMessageText({
        content: "",
        additional_kwargs: { reasoning_content: '{"ok":true}' },
      }),
    ).toBe('{"ok":true}');
    expect(
      extractMessageText({
        content: '{"ok":false}',
        additional_kwargs: { reasoning_content: '{"ok":true}' },
      }),
    ).toBe('{"ok":false}');
  });

  it("parses raw, fenced, and embedded JSON objects", () => {
    expect(parseJsonValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonValue('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonValue('noise {"a":3} trailing')).toEqual({ a: 3 });
    expect(parseJsonValue("")).toBeUndefined();
    expect(parseJsonValue("not json")).toBeUndefined();
  });

  it("treats abort/timeout names as timeouts", () => {
    expect(isTimeoutErr({ name: "AbortError", message: "aborted" })).toBe(true);
    expect(isTimeoutErr({ name: "TimeoutError" })).toBe(true);
    expect(isTimeoutErr(new Error("aar timed out after 12000ms"))).toBe(true);
    expect(isTimeoutErr(new Error("400 bad request"))).toBe(false);
  });

  it("uses jsonMode for Muse, Grok, and GPT Completions slugs", () => {
    expect(structuredMethodForModel("muse-spark-1.2")).toBe("jsonMode");
    expect(structuredMethodForModel("muse-glimmer-30b")).toBe("jsonMode");
    expect(structuredMethodForModel("grok-4.5")).toBe("jsonMode");
    expect(structuredMethodForModel("gpt-5.6-sol")).toBe("jsonMode");
    expect(structuredMethodForModel("gemini-3.1-pro-preview")).toBeUndefined();
    expect(structuredMethodForModel("")).toBeUndefined();
    expect(skipNativeStructured("muse-glimmer-30b")).toBe(true);
    expect(skipNativeStructured("muse-spark-1.2")).toBe(false);
  });

  it("Glimmer reads JSON from reasoning_content when content is empty", async () => {
    const llm = fakeLlm({
      model: "muse-glimmer-30b",
      structured: async () => {
        throw new Error("native structured should be skipped");
      },
      invoke: async () => ({
        content: "",
        additional_kwargs: { reasoning_content: JSON.stringify(intent) },
      }),
    });
    const out = await invokeStructured(llm, CoachIntentSchema, messages, { label: "glimmer", noJsonRetry: true });
    expect(out?.playId).toBe("5v5-122-forecheck");
  });
});

describe("invokeStructured", () => {
  it("coerces LLM pressure aliases like high/attack", async () => {
    const fake = new FakeListChatModel({
      responses: [
        JSON.stringify({
          supposedToHappen: "crash the net",
          playId: "oz-crash-net",
          pressure: "high",
        }),
      ],
    });
    const out = await invokeStructured(fake, CoachIntentSchema, messages, { label: "test-pressure" });
    expect(out?.pressure).toBe("aggressive");
    expect(out?.playId).toBe("oz-crash-net");
  });

  it("parses FakeListChatModel withStructuredOutput JSON", async () => {
    const fake = new FakeListChatModel({ responses: [JSON.stringify(intent)] });
    const out = await invokeStructured(fake, CoachIntentSchema, messages, { label: "test-fake" });
    expect(out).toEqual(intent);
  });

  it("falls back to invoke JSON after a fast structured failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = fakeLlm({
      structured: async () => {
        throw new Error("400 Invalid schema for response_format");
      },
      invoke: async () => ({ content: JSON.stringify(intent) }),
    });
    const out = await invokeStructured(llm, CoachIntentSchema, messages, { label: "test-json" });
    expect(out).toEqual(intent);
    expect(warn).toHaveBeenCalled();
  });

  it("parses JSON sitting in a text content block", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = fakeLlm({
      structured: async () => {
        throw new Error("No structured output found");
      },
      invoke: async () => ({
        content: [
          { type: "reasoning", text: "hidden" },
          { type: "text", text: JSON.stringify(intent) },
        ],
      }),
    });
    const out = await invokeStructured(llm, CoachIntentSchema, messages);
    expect(out?.playId).toBe("5v5-122-forecheck");
  });

  it("coach parse-fail does not spend a second invoke", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let jsonCalls = 0;
    const llm = fakeLlm({
      structured: async () => ({ supposedToHappen: "x" }),
      invoke: async () => {
        jsonCalls += 1;
        return { content: JSON.stringify(intent) };
      },
    });
    const out = await invokeStructured(llm, CoachIntentSchema, messages, { label: "coach", noJsonRetry: true });
    expect(out).toBeUndefined();
    expect(jsonCalls).toBe(0);
  });

  it("does not spend a second invoke after a timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let jsonCalls = 0;
    const err = new Error("aborted");
    err.name = "AbortError";
    const llm = fakeLlm({
      structured: async () => {
        throw err;
      },
      invoke: async () => {
        jsonCalls += 1;
        return { content: JSON.stringify(intent) };
      },
    });
    const out = await invokeStructured(llm, CoachIntentSchema, messages, { label: "test-timeout" });
    expect(out).toBeUndefined();
    expect(jsonCalls).toBe(0);
  });

  it("returns undefined when neither path parses", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = fakeLlm({
      structured: async () => "not-an-intent",
      invoke: async () => ({ content: "still not json" }),
    });
    const out = await invokeStructured(llm, z.object({ n: z.number() }), messages);
    expect(out).toBeUndefined();
  });

  it("marks grok-4.3 none unsupported only when the error cites reasoning_effort", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(chatModelSpec("fast", {}).effort).toBe("low");
    const schema400 = fakeLlm({
      structured: async () => {
        throw new Error("400 Invalid schema for response_format");
      },
      invoke: async () => ({ content: JSON.stringify(intent) }),
    });
    await invokeStructured(schema400, CoachIntentSchema, messages);
    expect(chatModelSpec("fast", {}).effort).toBe("low");

    const none400 = fakeLlm({
      structured: async () => {
        throw new Error("400 reasoning_effort none is not supported");
      },
      invoke: async () => ({ content: JSON.stringify(intent) }),
    });
    await invokeStructured(none400, CoachIntentSchema, messages);
    expect(chatModelSpec("fast", {}).effort).toBe("low");
  });

  it("jsonMode returns a loose object then coerces pressure high", async () => {
    const capturing = {
      model: "grok-4.5",
      withStructuredOutput: (_schema: unknown, config?: { method?: string }) => {
        expect(config?.method).toBe("jsonMode");
        return {
          invoke: async () => ({
            supposedToHappen: "crash the net",
            playId: "oz-crash-net",
            pressure: "high",
            intent: "extra-field",
          }),
        };
      },
      invoke: async () => ({ content: "" }),
    };
    const out = await invokeStructured(
      capturing as unknown as BaseChatModel,
      CoachIntentSchema,
      messages,
    );
    expect(out?.pressure).toBe("aggressive");
    expect(out?.playId).toBe("oz-crash-net");
  });

  it("maps specialist advice to memo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { SpecialistAdviceSchema } = await import("../agents/specialists/compile.ts");
    const llm = fakeLlm({
      structured: async () => ({ advice: "pass to the slot", params: { shotPolicy: "pass" } }),
    });
    const out = await invokeStructured(llm, SpecialistAdviceSchema, messages);
    expect(out?.memo).toBe("pass to the slot");
    expect(out?.params?.shotPolicy).toBe("pass");
  });

  it("prepends a JSON-object hint when the model is Muse Glimmer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let seen: unknown;
    const capturing = {
      model: "muse-glimmer-30b",
      withStructuredOutput: () => {
        throw new Error("glimmer skips native structured");
      },
      invoke: async (input: unknown) => {
        seen = input;
        return { content: JSON.stringify(intent) };
      },
    };
    const out = await invokeStructured(
      capturing as unknown as BaseChatModel,
      CoachIntentSchema,
      messages,
    );
    expect(out).toEqual(intent);
    expect(Array.isArray(seen)).toBe(true);
    const first = (seen as { content?: unknown }[])[0];
    expect(String(first?.content ?? first)).toMatch(/JSON object/i);
  });
});
