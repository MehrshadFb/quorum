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
// Auth: gemini auth login (OAuth) or GEMINI_API_KEY env var.

// NOTE: no env-var precheck — gemini CLI may read auth from a config file
// after `gemini auth login`. Let it error itself if no usable credential.

export const gemini: AgentRunner = {
  name: 'gemini',
  async review(input: AgentInput): Promise<Review> {
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
