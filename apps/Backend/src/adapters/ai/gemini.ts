/**
 * The ONLY file that talks to the provider (Docs/06-touch-map.md's "exactly one writer" list,
 * AB-14's grep). Swapping vendors is a change here and nowhere else — Gemini instead of the
 * spec's Anthropic Claude is a deliberate, recorded deviation (Docs/03-decisions.md).
 *
 * Returns raw text for the caller to parse and validate; it does not interpret the response,
 * and it never gives the model a tool, SQL access or any write capability (INV-44).
 */
import { GoogleGenAI } from '@google/genai';
import { env } from '../../env.ts';
import { POLICY } from '../../core/policy.ts';

const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY ?? '' });

export async function generateStructured(input: {
  promptVersion: string;
  system: string;
  user: string;
  responseSchema: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ text: string; model: string; latencyMs: number; inputTokens?: number; outputTokens?: number }> {
  const startedAt = performance.now();
  const response = await client.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: input.user,
    config: {
      systemInstruction: input.system,
      responseMimeType: 'application/json',
      responseJsonSchema: input.responseSchema,
      httpOptions: { timeout: input.timeoutMs ?? POLICY.ai.timeoutMs },
    },
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  return {
    text: response.text ?? '',
    model: env.GEMINI_MODEL,
    latencyMs,
    inputTokens: response.usageMetadata?.promptTokenCount,
    outputTokens: response.usageMetadata?.candidatesTokenCount,
  };
}
