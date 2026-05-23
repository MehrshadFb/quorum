import { parseAgentJSON, errorReview, spawnCapture, type AgentRunner, type AgentInput } from './util.js';
import type { Review } from '../consensus.js';

// Confirmed against `claude --help` (Claude Code 2.1+):
//   -p / --print                  non-interactive print mode
//   --tools ""                    disable all tools (we want pure text-in/text-out, no file edits)
//   --output-format text|json     "text" returns the raw response on stdout
//   --allow-dangerously-skip-permissions   non-interactive, no permission prompts
//   --max-budget-usd <amt>        budget cap (only works with --print)
//   --model <name>                model override (e.g. claude-opus-4-7)
//
// NOTE: we deliberately do NOT use --bare here. --bare disables OAuth and
// keychain auth, only accepting ANTHROPIC_API_KEY. We want Claude Code to
// use whichever credential is available (CLAUDE_CODE_OAUTH_TOKEN from env,
// the keychain set up by `claude setup-token`, OR ANTHROPIC_API_KEY).
//
// Auth resolution order: CLAUDE_CODE_OAUTH_TOKEN env → keychain (set by
// `claude setup-token`) → ANTHROPIC_API_KEY env. Claude Code picks the
// first one it finds. We don't preflight-check env vars because keychain
// auth wouldn't pass.

export const claude: AgentRunner = {
  name: 'claude',
  async review(input: AgentInput): Promise<Review> {
    try {
      const args = [
        '-p',
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
