import * as core from '@actions/core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawnCapture } from './agents/util.js';
import { renderImplementerPrompt } from './prompt.js';
import { QUORUM_BOT_NAME, QUORUM_BOT_EMAIL } from './deliberation.js';
import type { QuorumConfig, AgentName } from './config.js';

const exec = promisify(execFile);

export interface ImplementerInput {
  agent: AgentName;
  config: QuorumConfig;
  title: string;
  description: string;
  diff: string;
  concernsBlock: string;
  round: number;
}

/**
 * Runs the implementer agent with file-edit access, then commits + pushes
 * whatever files it changed. Returns true if a commit was pushed.
 */
export async function runImplementer(input: ImplementerInput): Promise<boolean> {
  if (input.agent === 'grok') {
    core.warning('grok cannot be the implementer (no file-edit capability via API). Set deliberation_options.implementer to claude, codex, or gemini.');
    return false;
  }

  const prompt = renderImplementerPrompt({
    title: input.title,
    description: input.description,
    diff: input.diff,
    concerns: input.concernsBlock,
  });

  const opts = input.config.agents.options[input.agent] ?? {};

  try {
    if (input.agent === 'claude') await runClaudeImplementer(prompt, opts);
    else if (input.agent === 'codex') await runCodexImplementer(prompt, opts);
    else if (input.agent === 'gemini') await runGeminiImplementer(prompt, opts);
  } catch (err) {
    core.warning(`Implementer ${input.agent} failed: ${(err as Error).message}`);
    return false;
  }

  const { stdout: status } = await exec('git', ['status', '--porcelain']);
  if (!status.trim()) {
    core.warning(`Implementer ${input.agent} made no file changes`);
    return false;
  }

  core.info(`Implementer changed files:\n${status}`);

  await exec('git', ['config', 'user.name', QUORUM_BOT_NAME]);
  await exec('git', ['config', 'user.email', QUORUM_BOT_EMAIL]);
  await exec('git', ['add', '-A']);
  await exec('git', [
    'commit',
    '-m',
    `quorum: round ${input.round} fixes (via ${input.agent})\n\nAddresses concerns raised by ${input.config.agents.required.join(', ')}.`,
  ]);

  try {
    await exec('git', ['push']);
    core.info('Pushed implementer fixes. The push will re-trigger Quorum.');
    return true;
  } catch (err) {
    core.error(`Failed to push fixes: ${(err as Error).message}`);
    core.error('The checkout token may lack push permission. Use a PAT in QUORUM_BOT_TOKEN with actions/checkout@v4 (token: ...).');
    return false;
  }
}

async function runClaudeImplementer(prompt: string, opts: { model?: string; timeout_ms?: number }): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('no ANTHROPIC_API_KEY in env');
  }
  const args = [
    '-p',
    '--bare',
    '--tools', 'Read,Edit,Write,Glob,Grep',
    '--output-format', 'text',
    '--allow-dangerously-skip-permissions',
    '--max-budget-usd', '10',
    '--permission-mode', 'auto',
  ];
  if (opts.model) args.push('--model', opts.model);
  await spawnCapture({
    cmd: 'claude',
    args,
    stdin: prompt,
    timeoutMs: opts.timeout_ms ?? 600_000,
  });
}

async function runCodexImplementer(prompt: string, opts: { model?: string; timeout_ms?: number }): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('no OPENAI_API_KEY in env');
  }
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--sandbox', 'workspace-write',
    '--color', 'never',
    '--full-auto',
  ];
  if (opts.model) args.push('--model', opts.model);
  args.push('-');
  await spawnCapture({
    cmd: 'codex',
    args,
    stdin: prompt,
    timeoutMs: opts.timeout_ms ?? 600_000,
  });
}

async function runGeminiImplementer(prompt: string, opts: { model?: string; timeout_ms?: number }): Promise<void> {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    throw new Error('no GEMINI_API_KEY or GOOGLE_API_KEY in env');
  }
  // --approval-mode yolo: auto-approve all tool actions (edits, writes).
  // --skip-trust: trust the current workspace.
  const args = [
    '-p', prompt,
    '--skip-trust',
    '--approval-mode', 'yolo',
    '-o', 'text',
  ];
  if (opts.model) args.push('--model', opts.model);
  await spawnCapture({
    cmd: 'gemini',
    args,
    stdin: '',
    timeoutMs: opts.timeout_ms ?? 600_000,
  });
}
