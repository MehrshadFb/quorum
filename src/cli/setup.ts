import { mkdir, copyFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { stringify } from 'yaml';
import {
  type AgentName,
  type Mode,
  type Deliberation,
  KNOWN_AGENTS,
  DEFAULT_CONFIG,
} from '../config.js';
import {
  checkNodeVersion,
  checkGitRepo,
  checkGitRemote,
  checkGhAuthed,
  checkAgentCli,
  agentInstallHint,
  checkClaudeToken,
  checkCodexToken,
  checkGeminiToken,
  checkGrokKey,
  isCommandAvailable,
} from '../checks.js';

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = join(HERE, '..', '..', 'template');

interface SetupOpts {
  skipAuth?: boolean;
  yes?: boolean;
}

const SECRET_NAMES: Record<AgentName, { secret: string; envVar: string; setupCmd: string; description: string }> = {
  claude: {
    secret: 'QUORUM_CLAUDE_TOKEN',
    envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    setupCmd: 'claude setup-token',
    description: 'Sign in with Claude Pro/Max (OAuth, stored in ~/.claude/).',
  },
  codex: {
    secret: 'QUORUM_CODEX_TOKEN',
    envVar: 'OPENAI_API_KEY',
    setupCmd: 'codex login',
    description: 'Sign in with ChatGPT (or paste an OPENAI_API_KEY).',
  },
  gemini: {
    secret: 'QUORUM_GEMINI_TOKEN',
    envVar: 'GEMINI_API_KEY',
    setupCmd: 'gemini auth login',
    description: 'Sign in with Google (or paste a GEMINI_API_KEY from AI Studio).',
  },
  grok: {
    secret: 'QUORUM_GROK_API_KEY',
    envVar: 'XAI_API_KEY',
    setupCmd: 'Get a key at https://console.x.ai',
    description: 'API key only — Grok has no OAuth.',
  },
};

export async function setupCmd(opts: SetupOpts): Promise<void> {
  console.clear();
  p.intro(pc.bgMagenta(pc.white(' quorum  setup ')));
  p.note(
    'Quorum makes every PR pass through multiple AI reviewers before merge.\nThis wizard installs the workflow, captures provider tokens, and shows you how to lock down main.',
    'what this does',
  );

  // 1. Prerequisites
  const preflightSpinner = p.spinner();
  preflightSpinner.start('Checking your environment');
  const preflight = await Promise.all([
    checkNodeVersion(),
    checkGitRepo(),
    checkGitRemote(),
    checkGhAuthed(),
  ]);
  preflightSpinner.stop('Environment check');

  for (const c of preflight) {
    const icon = c.ok ? pc.green('✓') : pc.red('✗');
    console.log(`  ${icon} ${c.name}${c.detail ? pc.dim(` — ${c.detail}`) : ''}`);
    if (!c.ok && c.fix) console.log(pc.dim(`      ${c.fix}`));
  }

  const blockers = preflight.filter(c => !c.ok && (c.name === 'Node.js ≥ 20' || c.name === 'Git repository'));
  if (blockers.length > 0) {
    p.cancel('Fix the items above and re-run `quorum setup`.');
    process.exit(1);
  }

  const ghOk = preflight.find(c => c.name === 'gh CLI authed')?.ok ?? false;
  if (!ghOk) {
    const proceed = await p.confirm({
      message: 'gh CLI isn\'t ready. Continue without auto-pushing secrets (you\'ll set them manually)?',
      initialValue: true,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Install/auth gh, then re-run.');
      process.exit(1);
    }
  }

  // 2. Choose agents
  const chosen = opts.yes ? ['claude', 'codex', 'gemini'] as AgentName[] : await p.multiselect({
    message: 'Which AI agents should review your PRs?  (need ≥2)',
    options: KNOWN_AGENTS.map(name => ({
      value: name,
      label: agentLabel(name),
      hint: SECRET_NAMES[name].description,
    })),
    initialValues: ['claude', 'codex', 'gemini'] as AgentName[],
    required: true,
  });
  if (p.isCancel(chosen)) { p.cancel('Cancelled.'); process.exit(1); }
  const required = chosen as AgentName[];

  if (required.length < 2) {
    p.cancel('Quorum needs at least 2 agents. Re-run and pick 2 or more.');
    process.exit(1);
  }

  // 3. Choose consensus mode (who must approve)
  const modeChoice = opts.yes ? 'strict' : await p.select<Mode>({
    message: 'Consensus mode — who must approve?',
    options: [
      { value: 'strict', label: 'Strict — all required agents must approve', hint: 'recommended' },
      ...(required.length >= 3 ? [{ value: 'majority' as Mode, label: 'Majority — >50% must approve', hint: 'tiebreaker on dissent' }] : []),
    ],
    initialValue: 'strict',
  });
  if (p.isCancel(modeChoice)) { p.cancel('Cancelled.'); process.exit(1); }
  const mode = modeChoice as Mode;

  // 3b. Choose deliberation mode (HOW agents reach a verdict)
  const deliberationChoice = opts.yes ? 'silent' : await p.select<Deliberation>({
    message: 'How should agents arrive at their verdict?',
    options: [
      { value: 'silent', label: 'Silent — blind parallel reviews', hint: 'most honest signal; default' },
      { value: 'debate', label: 'Debate — round 2 they see each other and can update', hint: 'risk: agents may cave to peer pressure' },
      { value: 'collaborate', label: 'Collaborate — debate + one agent commits fixes; loop until consensus', hint: 'needs a bot token with push access; closest to "ready-to-merge PRs"' },
    ],
    initialValue: 'silent',
  });
  if (p.isCancel(deliberationChoice)) { p.cancel('Cancelled.'); process.exit(1); }
  const deliberation = deliberationChoice as Deliberation;

  let implementer: AgentName = 'claude';
  let usePat = false;
  if (deliberation === 'collaborate') {
    const cliImplementers = required.filter(a => a !== 'grok');
    if (cliImplementers.length === 0) {
      p.cancel('Collaborate mode needs at least one CLI-based agent (claude, codex, or gemini) in `required`. Grok can\'t edit files.');
      process.exit(1);
    }
    const implementerChoice = await p.select<AgentName>({
      message: 'Which agent should commit the fixes when agents disagree?',
      options: cliImplementers.map(a => ({ value: a, label: agentLabel(a) })),
      initialValue: cliImplementers[0]!,
    });
    if (p.isCancel(implementerChoice)) { p.cancel('Cancelled.'); process.exit(1); }
    implementer = implementerChoice as AgentName;

    p.note(
      [
        'Collaborate mode pushes commits from your repo\'s CI to the PR branch.',
        '',
        'GitHub\'s default `GITHUB_TOKEN` cannot push commits that trigger downstream workflows',
        '(security feature). For the iteration loop to work, the workflow needs a PAT or GitHub App',
        'token in a secret named ' + pc.cyan('QUORUM_BOT_TOKEN') + '.',
        '',
        '- Yes: I\'ll wire `actions/checkout` to prefer QUORUM_BOT_TOKEN, you set it as a repo secret with',
        '  a fine-scoped PAT (repo: contents/pull-requests write).',
        '- No: collaborate still works but you\'ll need to manually push or close/reopen the PR to',
        '  re-trigger reviews after the implementer commits.',
      ].join('\n'),
      'bot token for collaborate',
    );
    const patChoice = await p.confirm({
      message: 'Wire the workflow to use QUORUM_BOT_TOKEN (recommended)?',
      initialValue: true,
    });
    if (p.isCancel(patChoice)) { p.cancel('Cancelled.'); process.exit(1); }
    usePat = patChoice;
  }

  // 4. Comment + block behavior
  const block = opts.yes ? true : await p.confirm({
    message: 'Block merge when agents disagree? (off = advisory-only, comments but doesn\'t fail the check)',
    initialValue: true,
  });
  if (p.isCancel(block)) { p.cancel('Cancelled.'); process.exit(1); }

  // 5. Write config + workflow
  p.note('Writing config and workflow', 'step 2 of 3');

  const cfg = {
    agents: { required, advisory: [] as AgentName[] },
    mode,
    deliberation,
    deliberation_options: deliberation === 'silent' ? undefined : {
      max_rounds: DEFAULT_CONFIG.deliberation_options.max_rounds,
      implementer,
      bot_token_secret: 'QUORUM_BOT_TOKEN',
      escalate_after_no_progress: DEFAULT_CONFIG.deliberation_options.escalate_after_no_progress,
    },
    github: {
      post_comments: true,
      request_changes: block,
      fail_check: block,
      skip_label: DEFAULT_CONFIG.github.skip_label,
    },
    review: {
      max_diff_bytes: DEFAULT_CONFIG.review.max_diff_bytes,
      skip_paths: [] as string[],
    },
  };
  await writeWithBackup('quorum.config.yml', stringify(cfg, { indent: 2 }));
  console.log(pc.green('  ✓ wrote quorum.config.yml'));

  await mkdir('.github/workflows', { recursive: true });
  const workflowSrc = join(TEMPLATE_ROOT, '.github/workflows/quorum.yml');
  await writeWithBackup('.github/workflows/quorum.yml', null, workflowSrc);
  console.log(pc.green('  ✓ wrote .github/workflows/quorum.yml'));
  if (deliberation === 'collaborate' && usePat) {
    console.log(pc.dim('     (workflow uses QUORUM_BOT_TOKEN if set, falls back to GITHUB_TOKEN)'));
  }

  // 6. Agent auth
  if (opts.skipAuth) {
    p.note('Auth skipped. Run `quorum auth` when ready.', 'step 3 of 3');
  } else {
    p.note(`Setting up tokens for: ${required.join(', ')}`, 'step 3 of 3');
    for (const agent of required) {
      await setupAgent(agent, ghOk);
    }
  }

  // 7. Done — final checklist
  p.note(
    [
      'Quorum is installed. Final steps you do in GitHub:',
      '',
      '  1. Push your changes:  ' + pc.cyan('git add . && git commit -m "add quorum" && git push'),
      '  2. Protect main:        ' + pc.cyan('Repo → Settings → Branches → add rule for main'),
      '       require pull request before merge',
      '       require status check "Quorum" to pass',
      '       block force pushes',
      '  3. Open a PR — you\'ll see Quorum comment within ~30s.',
      '',
      pc.dim('Anytime: `quorum doctor` to verify, `quorum status` to inspect state.'),
    ].join('\n'),
    'you\'re done',
  );
  p.outro(pc.green('Ready to vibe code with guardrails.'));
}

function agentLabel(name: AgentName): string {
  switch (name) {
    case 'claude': return 'Claude  (Anthropic)';
    case 'codex':  return 'Codex   (OpenAI / ChatGPT)';
    case 'gemini': return 'Gemini  (Google)';
    case 'grok':   return 'Grok    (xAI)';
  }
}

async function setupAgent(agent: AgentName, ghOk: boolean): Promise<void> {
  const spec = SECRET_NAMES[agent];
  console.log('');
  console.log(pc.bold(`▸ ${agentLabel(agent)}`));

  // CLI install check (for the three CLI-based agents)
  if (agent !== 'grok') {
    const cliCheck = await checkAgentCli(agent);
    if (!cliCheck.ok) {
      const installNow = await p.confirm({
        message: `${agent} CLI not found. Install it now? (${agentInstallHint(agent)})`,
        initialValue: true,
      });
      if (!p.isCancel(installNow) && installNow) {
        const sp = p.spinner();
        sp.start(`Installing ${agentInstallHint(agent)}`);
        try {
          const pkg = installPackageFor(agent);
          await exec('npm', ['i', '-g', pkg], { maxBuffer: 20 * 1024 * 1024 });
          sp.stop(pc.green(`installed ${pkg}`));
        } catch (err) {
          sp.stop(pc.yellow(`install failed (${(err as Error).message.slice(0, 80)}) — install manually and re-run \`quorum auth --agent ${agent}\``));
        }
      } else {
        console.log(pc.yellow(`  skipped — run \`${agentInstallHint(agent)}\` later, then \`quorum auth --agent ${agent}\``));
        return;
      }
    }
  }

  // Already have a token?
  const existing = await readExistingToken(agent);
  let token = existing;

  if (existing) {
    const reuse = await p.confirm({
      message: `Found a token for ${agent}. Reuse it?`,
      initialValue: true,
    });
    if (p.isCancel(reuse)) return;
    if (!reuse) token = null;
  }

  if (!token) {
    if (agent === 'grok') {
      const entered = await p.password({
        message: 'Paste your xAI API key (from https://console.x.ai):',
        mask: '•',
      });
      if (p.isCancel(entered) || !entered) {
        console.log(pc.yellow('  skipped'));
        return;
      }
      token = entered;
    } else {
      p.note(
        `Run this in another terminal, complete the sign-in, then come back here:\n  ${pc.cyan(spec.setupCmd)}`,
        `${agent} sign-in`,
      );
      const ready = await p.confirm({ message: 'Signed in?', initialValue: true });
      if (p.isCancel(ready) || !ready) {
        console.log(pc.yellow(`  skipped — re-run \`quorum auth --agent ${agent}\` later`));
        return;
      }
      token = await readExistingToken(agent);
      if (!token) {
        const entered = await p.password({
          message: `Couldn't find a token automatically. Paste it (or an API key fallback):`,
          mask: '•',
        });
        if (p.isCancel(entered) || !entered) {
          console.log(pc.yellow('  skipped'));
          return;
        }
        token = entered;
      }
    }
  }

  // Push to repo secret
  if (!ghOk) {
    console.log(pc.yellow(`  gh not authed — set this manually in GitHub repo settings:`));
    console.log(`     Name:   ${pc.cyan(spec.secret)}`);
    console.log(`     Value:  (the token you just captured)`);
    return;
  }

  const sp = p.spinner();
  sp.start(`Pushing → repo secret ${spec.secret}`);
  try {
    await exec('gh', ['secret', 'set', spec.secret, '--body', token], { maxBuffer: 1024 * 1024 });
    sp.stop(pc.green(`  ✓ ${spec.secret}  (workflow reads as ${spec.envVar})`));
  } catch (err) {
    sp.stop(pc.red(`  ✗ failed: ${(err as Error).message.slice(0, 200)}`));
    console.log(pc.dim('     Run `gh auth login` then `quorum auth --agent ' + agent + '` to retry.'));
  }
}

async function readExistingToken(agent: AgentName): Promise<string | null> {
  switch (agent) {
    case 'claude': return await checkClaudeToken();
    case 'codex':  return await checkCodexToken();
    case 'gemini': return await checkGeminiToken();
    case 'grok':   return await checkGrokKey();
  }
}

function installPackageFor(agent: AgentName): string {
  switch (agent) {
    case 'claude': return '@anthropic-ai/claude-code';
    case 'codex':  return '@openai/codex';
    case 'gemini': return '@google/gemini-cli';
    case 'grok':   return '';
  }
}

async function writeWithBackup(dest: string, content: string | null, copyFrom?: string): Promise<void> {
  const exists = await fileExists(dest);
  if (exists) {
    const overwrite = await p.confirm({
      message: `${dest} already exists. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      console.log(pc.dim(`  • kept existing ${dest}`));
      return;
    }
  }
  await mkdir(dirname(dest), { recursive: true });
  if (copyFrom) await copyFile(copyFrom, dest);
  else if (content !== null) await writeFile(dest, content, 'utf8');
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

void isCommandAvailable;
