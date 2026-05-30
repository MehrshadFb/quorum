import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentName } from '../config.js';
import {
  checkClaudeToken,
  checkCodexToken,
  checkGeminiToken,
  checkGrokKey,
  checkGhAuthed,
} from '../checks.js';

const exec = promisify(execFile);

interface AuthOpts {
  agent?: AgentName;
  push?: boolean;
}

interface Spec {
  name: AgentName;
  secret: string;
  envVar: string;
  prompt: string;
  capture: () => Promise<string | null>;
}

const SPECS: Spec[] = [
  { name: 'claude', secret: 'QUORUM_CLAUDE_TOKEN',    envVar: 'ANTHROPIC_API_KEY', prompt: 'Paste your Anthropic API key:', capture: checkClaudeToken },
  { name: 'codex',  secret: 'QUORUM_CODEX_TOKEN',     envVar: 'OPENAI_API_KEY',    prompt: 'Paste your OpenAI API key:',    capture: checkCodexToken },
  { name: 'gemini', secret: 'QUORUM_GEMINI_TOKEN',    envVar: 'GEMINI_API_KEY',    prompt: 'Paste your Gemini API key:',    capture: checkGeminiToken },
  { name: 'grok',   secret: 'QUORUM_GROK_API_KEY',    envVar: 'XAI_API_KEY',       prompt: 'Paste your xAI API key:',       capture: checkGrokKey },
];

export async function authCmd(opts: AuthOpts): Promise<void> {
  const push = opts.push !== false;
  const targets = opts.agent ? SPECS.filter(s => s.name === opts.agent) : SPECS;

  p.intro(pc.bgMagenta(pc.white(' quorum  auth ')));

  if (push) {
    const ghOk = await checkGhAuthed();
    if (!ghOk.ok) {
      p.note(`gh CLI isn't ready (${ghOk.detail}). Continue without auto-pushing? API key lengths will be printed for you to set manually.`, 'heads up');
      const proceed = await p.confirm({ message: 'Continue without pushing?', initialValue: true });
      if (p.isCancel(proceed) || !proceed) { p.cancel('Auth gh then re-run.'); process.exit(1); }
      opts.push = false;
    }
  }

  for (const spec of targets) {
    console.log('');
    console.log(pc.bold(`▸ ${spec.name}`));
    let token = await spec.capture();

    if (token) {
      const reuse = await p.confirm({ message: `Found an API key for ${spec.name}. Use it?`, initialValue: true });
      if (p.isCancel(reuse)) continue;
      if (!reuse) token = null;
    }

    if (!token) {
      const entered = await p.password({ message: spec.prompt, mask: '•' });
      if (p.isCancel(entered) || !entered) { console.log(pc.yellow('  skipped')); continue; }
      token = entered;
    }

    if (opts.push === false) {
      console.log(pc.dim(`  Set manually as repo secret ${pc.cyan(spec.secret)} (action reads as ${spec.envVar}).`));
      console.log(pc.dim(`  Value length: ${token.length} chars.`));
      continue;
    }

    const sp = p.spinner();
    sp.start(`Pushing → repo secret ${spec.secret}`);
    try {
      await exec('gh', ['secret', 'set', spec.secret, '--body', token]);
      sp.stop(pc.green(`  ✓ ${spec.secret}  (workflow reads as ${spec.envVar})`));
    } catch (err) {
      sp.stop(pc.red(`  ✗ failed: ${(err as Error).message.slice(0, 200)}`));
    }
  }

  p.outro(pc.green('Auth setup complete. Run `quorum doctor` to verify.'));
}
