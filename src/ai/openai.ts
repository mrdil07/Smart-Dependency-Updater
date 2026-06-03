/**
 * OpenAI client wrapper: sends the prompt and parses the model's JSON response
 * into a validated AiResult.
 */
import OpenAI from 'openai';
import { AiChange, AiResult } from '../types';
import { buildMessages, PromptInput } from './prompt';

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/** Defensively parse and validate the model's JSON output. */
export function parseAiResult(raw: string): AiResult {
  let text = raw.trim();

  // Strip ```json fences if the model added them despite instructions.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    text = fenced[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      summary: '',
      changes: [],
      unableToFix: true,
      reason: 'Model did not return valid JSON.',
    };
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const rawChanges = Array.isArray(obj.changes) ? obj.changes : [];
  const changes: AiChange[] = rawChanges
    .map((c) => c as Record<string, unknown>)
    .filter(
      (c) => typeof c.path === 'string' && typeof c.content === 'string',
    )
    .map((c) => ({ path: c.path as string, content: c.content as string }));

  const unableToFix = obj.unableToFix === true || changes.length === 0;

  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    changes,
    unableToFix,
    reason: typeof obj.reason === 'string' ? obj.reason : undefined,
  };
}

export async function requestFix(
  options: OpenAiOptions,
  input: PromptInput,
): Promise<AiResult> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
  });

  const messages = buildMessages(input);

  const response = await client.chat.completions.create({
    model: options.model,
    messages,
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content ?? '';
  return parseAiResult(content);
}
