import { z } from "zod";

export const PROVIDER_IDS = ["xai", "muse", "openai", "gemini"] as const;
export const ProviderIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderIdSchema>;
