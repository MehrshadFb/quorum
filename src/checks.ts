import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentName } from './config.js';

const exec = promisify(execFile);

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
  fix?: string;
}

export async function isCommandAvailable(cmd: string): Promise<boolean> {
  try {
    await exec('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

export async function checkNodeVersion(): Promise<CheckResult> {
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0] ?? '0', 10);
  if (major >= 20) return { name: 'Node.js ≥ 20', ok: true, detail: `v${v}` };
  return {
    name: 'Node.js ≥ 20',
    ok: false,
    detail: `v${v}`,
    fix: 'Install Node 20 or newer (`nvm install 20` or https://nodejs.org).',
  };
}

export async function checkGitRepo(cwd = process.cwd()): Promise<CheckResult> {
  try {
    await access(join(cwd, '.git'));
    return { name: 'Git repository', ok: true };
  } catch {
    return {
      name: 'Git repository',
      ok: false,
      detail: 'no .git directory',
      fix: 'Run `git init` and add a remote, or cd into your existing repo first.',
    };
  }
}

export async function checkGitRemote(): Promise<CheckResult> {
  try {
    const { stdout } = await exec('git', ['remote', 'get-url', 'origin']);
    const url = stdout.trim();
    if (url.includes('github.com')) {
      return { name: 'GitHub remote', ok: true, detail: url };
    }
    return {
      name: 'GitHub remote',
      ok: false,
      detail: `origin → ${url} (not a GitHub URL)`,
      fix: 'Quorum runs as a GitHub Action; you need a github.com remote for the workflow to execute.',
    };
  } catch {
    return {
      name: 'GitHub remote',
      ok: false,
      detail: 'no `origin` remote',
      fix: 'Add a GitHub remote: `git remote add origin git@github.com:you/repo.git`.',
    };
  }
}

export async function checkGhAuthed(): Promise<CheckResult> {
  if (!await isCommandAvailable('gh')) {
    return {
      name: 'gh CLI authed',
      ok: false,
      detail: 'gh not installed',
      fix: 'Install GitHub CLI: https://cli.github.com (or `brew install gh`).',
    };
  }
  try {
    await exec('gh', ['auth', 'status']);
    return { name: 'gh CLI authed', ok: true };
  } catch {
    return {
      name: 'gh CLI authed',
      ok: false,
      detail: 'not signed in',
      fix: 'Run `gh auth login` (needed to push secrets and set branch protection).',
    };
  }
}

export async function checkAgentCli(agent: AgentName): Promise<CheckResult> {
  if (agent === 'grok') {
    return { name: 'grok (API key)', ok: true, detail: 'no CLI required' };
  }
  const cmd = agent;
  const available = await isCommandAvailable(cmd);
  if (available) return { name: `${agent} CLI`, ok: true };
  return {
    name: `${agent} CLI`,
    ok: false,
    detail: 'not installed',
    fix: agentInstallHint(agent),
  };
}

export function agentInstallHint(agent: AgentName): string {
  switch (agent) {
    case 'claude': return 'npm i -g @anthropic-ai/claude-code';
    case 'codex':  return 'npm i -g @openai/codex';
    case 'gemini': return 'npm i -g @google/gemini-cli';
    case 'grok':   return 'No CLI — use XAI_API_KEY only.';
  }
}

export async function checkConfigPresent(cwd = process.cwd()): Promise<CheckResult> {
  try {
    await access(join(cwd, 'quorum.config.yml'));
    return { name: 'quorum.config.yml present', ok: true };
  } catch {
    return {
      name: 'quorum.config.yml present',
      ok: false,
      detail: 'not found',
      fix: 'Run `quorum init` (or `quorum setup`).',
    };
  }
}

export async function checkWorkflowPresent(cwd = process.cwd()): Promise<CheckResult> {
  const p = join(cwd, '.github', 'workflows', 'quorum.yml');
  try {
    const s = await stat(p);
    if (s.isFile()) return { name: 'quorum workflow installed', ok: true };
  } catch {}
  return {
    name: 'quorum workflow installed',
    ok: false,
    detail: '.github/workflows/quorum.yml not found',
    fix: 'Run `quorum init`.',
  };
}

export async function checkBranchProtection(): Promise<CheckResult> {
  if (!await isCommandAvailable('gh')) {
    return { name: 'main branch protected', ok: false, detail: 'gh not available', fix: 'Install gh CLI.' };
  }
  try {
    const { stdout } = await exec('gh', ['api', 'repos/:owner/:repo/branches/main/protection', '--silent']);
    void stdout;
    return { name: 'main branch protected', ok: true };
  } catch {
    return {
      name: 'main branch protected',
      ok: false,
      detail: 'no protection rule',
      fix: 'In GitHub repo settings → Branches → add a rule for `main` requiring the Quorum check and forbidding direct pushes.',
    };
  }
}

export async function checkClaudeToken(): Promise<string | null> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const candidates = [
    join(homedir(), '.claude', 'auth.json'),
    join(homedir(), '.claude', 'credentials.json'),
    join(homedir(), '.config', 'claude', 'auth.json'),
  ];
  for (const p of candidates) {
    try {
      const data = JSON.parse(await readFile(p, 'utf8'));
      const token = data.token ?? data.access_token ?? data.oauth_token ?? data.sessionKey;
      if (typeof token === 'string') return token;
    } catch {}
  }
  return null;
}

export async function checkCodexToken(): Promise<string | null> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (process.env.CODEX_SESSION_TOKEN) return process.env.CODEX_SESSION_TOKEN;
  try {
    const data = JSON.parse(await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8'));
    return data.token ?? data.access_token ?? null;
  } catch {
    return null;
  }
}

export async function checkGeminiToken(): Promise<string | null> {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_SESSION_TOKEN ?? null;
}

export async function checkGrokKey(): Promise<string | null> {
  return process.env.XAI_API_KEY ?? process.env.GROK_API_KEY ?? null;
}

export async function checkRepoSecret(name: string): Promise<CheckResult> {
  if (!await isCommandAvailable('gh')) {
    return { name: `secret: ${name}`, ok: false, detail: 'gh not installed' };
  }
  try {
    const { stdout } = await exec('gh', ['secret', 'list']);
    const present = stdout.split('\n').some(line => line.startsWith(name + '\t') || line.startsWith(name + ' '));
    if (present) return { name: `secret: ${name}`, ok: true };
    return { name: `secret: ${name}`, ok: false, detail: 'not set', fix: 'Run `quorum auth`.' };
  } catch (err) {
    return { name: `secret: ${name}`, ok: false, detail: (err as Error).message };
  }
}
