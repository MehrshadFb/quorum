import { parseAgentJSON, errorReview, type AgentRunner, type AgentInput } from './util.js';
import type { Review } from '../consensus.js';

const DEFAULT_MODEL = 'grok-4-latest';
const GROK_ENDPOINT = 'https://api.x.ai/v1/chat/completions';

export const grok: AgentRunner = {
  name: 'grok',
  async review(input: AgentInput): Promise<Review> {
    const apiKey = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY;
    if (!apiKey) {
      return errorReview('grok', 'no XAI_API_KEY or GROK_API_KEY in env');
    }
    const model = input.options?.model ?? process.env.GROK_MODEL ?? DEFAULT_MODEL;
    const timeoutMs = input.options?.timeout_ms ?? 180_000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(GROK_ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: input.prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          return errorReview('grok', `xAI API ${res.status}: ${text.slice(0, 300)}`);
        }
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content;
        if (!content) return errorReview('grok', 'xAI API returned no content');
        return parseAgentJSON(content, 'grok');
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return errorReview('grok', (err as Error).message);
    }
  },
};
