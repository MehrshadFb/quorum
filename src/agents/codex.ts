import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAgentJSON, errorReview, spawnCapture, type AgentRunner, type AgentInput } from './util.js';
import type { Review } from '../consensus.js';

// Confirmed against `codex exec --help` (codex-cli 0.125+):
//   exec [PROMPT|-]                   non-interactive; `-` reads prompt from stdin
//   --skip-git-repo-check             allow running outside a git repo (CI may not be one)
//   --ephemeral                       don't persist a session to disk
//   --sandbox read-only               agent can read but not mutate the workspace
//   --output-last-message <FILE>      write JUST the final assistant message to FILE (clean stdout)
//   --output-schema <FILE>            optional JSON Schema for structured output
//   -m, --model <name>                model override
//   --color never                     no ANSI in output
//
// Auth: reads OPENAI_API_KEY (or whatever auth `codex login` set up under $CODEX_HOME).

export const codex: AgentRunner = {
  name: 'codex',
  async review(input: AgentInput): Promise<Review> {
    if (!process.env.OPENAI_API_KEY && !process.env.CODEX_SESSION_TOKEN && !process.env.CODEX_HOME) {
      return errorReview('codex', 'no OPENAI_API_KEY/CODEX_SESSION_TOKEN/CODEX_HOME in env');
    }
    let workDir: string | null = null;
    try {
      workDir = await mkdtemp(join(tmpdir(), 'quorum-codex-'));
      const outputFile = join(workDir, 'last-message.txt');

      const args = [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox', 'read-only',
        '--color', 'never',
        '--output-last-message', outputFile,
      ];
      if (input.options?.model) args.push('--model', input.options.model);
      args.push('-'); // read prompt from stdin

      await spawnCapture({
        cmd: 'codex',
        args,
        stdin: input.prompt,
        timeoutMs: input.options?.timeout_ms ?? 180_000,
      });

      const message = await readFile(outputFile, 'utf8');
      return parseAgentJSON(message, 'codex');
    } catch (err) {
      return errorReview('codex', (err as Error).message);
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  },
};
