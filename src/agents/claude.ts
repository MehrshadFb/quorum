import { parseAgentJSON, errorReview, spawnCapture, type AgentRunner, type AgentInput } from './util.js';
import type { Review } from '../consensus.js';

// Confirmed against `claude --help` (Claude Code 2.1+):
//   -p / --print                  non-interactive print mode
//   --bare                        disable OAuth/keychain auth; use ANTHROPIC_API_KEY only
//   --tools ""                    disable all tools (we want pure text-in/text-out, no file edits)
//   --output-format text|json     "text" returns the raw response on stdout
//   --allow-dangerously-skip-permissions   non-interactive, no permission prompts
//   --max-budget-usd <amt>        budget cap (only works with --print)
//   --model <name>                model override (e.g. claude-opus-4-7)
//
// Auth: API key only via ANTHROPIC_API_KEY.

export const claude: AgentRunner = {
  name: 'claude',
  async review(input: AgentInput): Promise<Review> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return errorReview('claude', 'no ANTHROPIC_API_KEY in env');
    }
    try {
      const args = [
        '-p',
        '--bare',
        '--tools', '',
        '--output-format', 'text',
        '--allow-dangerously-skip-permissions',
        '--max-budget-usd', '5',
      ];
      if (input.options?.model) args.push('--model', input.options.model);

      const stdout = await spawnCapture({
        cmd: 'claude',
        args,
        stdin: input.prompt,
        timeoutMs: input.options?.timeout_ms ?? 180_000,
      });
      return parseAgentJSON(stdout, 'claude');
    } catch (err) {
      return errorReview('claude', (err as Error).message);
    }
  },
};
