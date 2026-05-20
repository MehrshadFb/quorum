import { parseAgentJSON, errorReview, spawnCapture, type AgentRunner, type AgentInput } from './util.js';
import type { Review } from '../consensus.js';

// Note: gemini CLI flags vary between releases (Google has shipped multiple
// "gemini" CLIs under different package names). We use a conservative
// invocation that the @google/gemini-cli accepts: `gemini -p <prompt>` or
// stdin via `gemini -p -`. If your installed CLI differs, set
// `agents.options.gemini.cli_args` and we will surface that in a future rev.
//
// Auth: reads GEMINI_API_KEY (or whatever `gemini auth login` configured).

export const gemini: AgentRunner = {
  name: 'gemini',
  async review(input: AgentInput): Promise<Review> {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY && !process.env.GEMINI_SESSION_TOKEN) {
      return errorReview('gemini', 'no GEMINI_API_KEY, GOOGLE_API_KEY, or GEMINI_SESSION_TOKEN in env');
    }
    try {
      const args = ['-p', '-'];
      if (input.options?.model) args.push('--model', input.options.model);

      const stdout = await spawnCapture({
        cmd: 'gemini',
        args,
        stdin: input.prompt,
        timeoutMs: input.options?.timeout_ms ?? 180_000,
      });
      return parseAgentJSON(stdout, 'gemini');
    } catch (err) {
      return errorReview('gemini', (err as Error).message);
    }
  },
};
