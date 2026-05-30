import { parseAgentJSON, errorReview, spawnCapture, type AgentRunner, type AgentInput } from './util.js';
import type { Review } from '../consensus.js';

// Confirmed against `gemini --help` (@google/gemini-cli):
//   -p, --prompt <string>     Non-interactive (headless) mode. The prompt MUST be a string argument
//                             (passing `-` is interpreted as a literal dash, not stdin → hangs).
//   --skip-trust              Trust the current workspace for this session (needed in CI/untrusted dirs).
//   --approval-mode plan      Read-only mode — no file edits, no tool execution.
//   -o, --output-format text  Plain text response, no formatting noise.
//   -m, --model <name>        Model override.
//
// Auth: API key only via GEMINI_API_KEY or GOOGLE_API_KEY.

export const gemini: AgentRunner = {
  name: 'gemini',
  async review(input: AgentInput): Promise<Review> {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
      return errorReview('gemini', 'no GEMINI_API_KEY or GOOGLE_API_KEY in env');
    }
    try {
      const args = [
        '-p', input.prompt,
        '--skip-trust',
        '--approval-mode', 'plan',
        '-o', 'text',
      ];
      if (input.options?.model) args.push('--model', input.options.model);

      const stdout = await spawnCapture({
        cmd: 'gemini',
        args,
        stdin: '',
        timeoutMs: input.options?.timeout_ms ?? 180_000,
      });
      return parseAgentJSON(stdout, 'gemini');
    } catch (err) {
      return errorReview('gemini', (err as Error).message);
    }
  },
};
