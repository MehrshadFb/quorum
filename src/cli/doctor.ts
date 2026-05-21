import pc from 'picocolors';
import {
  checkNodeVersion,
  checkGitRepo,
  checkGitRemote,
  checkGhAuthed,
  checkAgentCli,
  checkConfigPresent,
  checkWorkflowPresent,
  checkBranchProtection,
  checkRepoSecret,
  type CheckResult,
} from '../checks.js';
import { loadConfig } from '../config.js';

const SECRET_FOR: Record<string, string> = {
  claude: 'QUORUM_CLAUDE_TOKEN',
  codex: 'QUORUM_CODEX_TOKEN',
  gemini: 'QUORUM_GEMINI_TOKEN',
  grok: 'QUORUM_GROK_API_KEY',
};

export async function doctorCmd(): Promise<void> {
  console.log(pc.bold('Quorum doctor'));
  console.log(pc.dim('Diagnostic check for your quorum setup.'));
  console.log('');

  const groups: Array<{ title: string; checks: CheckResult[] }> = [];

  groups.push({
    title: 'Environment',
    checks: await Promise.all([
      checkNodeVersion(),
      checkGitRepo(),
      checkGitRemote(),
      checkGhAuthed(),
    ]),
  });

  groups.push({
    title: 'Quorum installed',
    checks: await Promise.all([
      checkConfigPresent(),
      checkWorkflowPresent(),
      checkBranchProtection(),
    ]),
  });

  // Per-agent CLI + secret checks based on config
  let configured: string[] = [];
  try {
    const cfg = await loadConfig('quorum.config.yml');
    configured = [...cfg.agents.required, ...cfg.agents.advisory];
  } catch {
    // no config yet — skip agent-specific checks
  }

  if (configured.length > 0) {
    const agentChecks: CheckResult[] = [];
    for (const agent of configured) {
      agentChecks.push(await checkAgentCli(agent as never));
      const secret = SECRET_FOR[agent];
      if (secret) agentChecks.push(await checkRepoSecret(secret));
    }
    groups.push({ title: `Agents (${configured.join(', ')})`, checks: agentChecks });
  }

  let allOk = true;
  for (const g of groups) {
    console.log(pc.bold(g.title));
    for (const c of g.checks) {
      const icon = c.ok ? pc.green('✓') : pc.red('✗');
      if (!c.ok) allOk = false;
      console.log(`  ${icon} ${c.name}${c.detail ? pc.dim(` — ${c.detail}`) : ''}`);
      if (!c.ok && c.fix) console.log(pc.dim(`      → ${c.fix}`));
    }
    console.log('');
  }

  if (allOk) {
    console.log(pc.green('All checks passed.'));
  } else {
    console.log(pc.yellow('Some checks failed. Run `quorum setup` for guided fixes.'));
    process.exitCode = 1;
  }
}
