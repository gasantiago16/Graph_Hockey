/**
 * Live Chat Completions smoke. Manual / local only.
 * CI must not run this unless XAI_API_KEY is present (this file exits 0 without a key).
 */
import { aarLlm, coachLlm, fastLlm, hasXaiApiKey, isXaiHttp400, markReasoningNoneUnsupported } from "../src/llm/client.ts";

function usageBlob(msg: {
  content: unknown;
  usage_metadata?: unknown;
  response_metadata?: unknown;
}) {
  return {
    content: msg.content,
    usage: msg.usage_metadata,
    response_metadata: msg.response_metadata,
  };
}

async function main(): Promise<void> {
  if (!hasXaiApiKey()) {
    console.log("skip smoke-xai-reasoning: XAI_API_KEY not set");
    return;
  }

  const prompt = 'Reply with the JSON {"ok":true} only.';
  const coachMsg = await coachLlm().invoke(prompt);
  console.log("coach grok-4.5 reasoning_effort=low");
  console.log(JSON.stringify(usageBlob(coachMsg), null, 2));

  try {
    const fastMsg = await fastLlm().invoke(prompt);
    console.log("fast grok-4.3 reasoning_effort=none");
    console.log(JSON.stringify(usageBlob(fastMsg), null, 2));
  } catch (err) {
    if (!isXaiHttp400(err)) throw err;
    markReasoningNoneUnsupported();
    const fastMsg = await fastLlm().invoke(prompt);
    console.log("fast grok-4.3 reasoning_effort=low (none unsupported)");
    console.log(JSON.stringify(usageBlob(fastMsg), null, 2));
  }

  const aarMsg = await aarLlm().invoke(prompt);
  console.log("aar grok-4.5 reasoning_effort=high");
  console.log(JSON.stringify(usageBlob(aarMsg), null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
