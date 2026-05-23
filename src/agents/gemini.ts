import { parseAgentJSON, errorReview, spawnCapture, type AgentRunner, type AgentInput } from './util.js';
import type { Review } from '../consensus.js';

// Note: gemini CLI flags vary between releases (Google has shipped multiple
// "gemini" CLIs under different package names). We use a conservative
// invocation that the @google/gemini-cli accepts: `gemini -p <prompt>` or
// stdin via `gemini -p -`. If your installed CLI differs, set
// `agents.options.gemini.cli_args` and we will surface that in a future rev.
//
// Auth: reads GEMINI_API_KEY (or whatever `gemini auth login` configured).

// NOTE: no env-var precheck — gemini CLI may read auth from a config file
// after `gemini auth login`. Let it error itself if no usable credential.

export const gemini: AgentRunner = {
  name: 'gemini',
  async review(input: AgentInput): Promise<Review> {
    try {
      // --skip-trust: gemini refuses non-interactive runs in untrusted dirs by default
      const args = ['-p', '-', '--skip-trust'];
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
