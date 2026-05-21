import pc from 'picocolors';
import { loadConfig } from '../config.js';
import { checkConfigPresent, checkWorkflowPresent, checkBranchProtection, checkRepoSecret } from '../checks.js';

const SECRET_FOR: Record<string, string> = {
  claude: 'QUORUM_CLAUDE_TOKEN',
  codex: 'QUORUM_CODEX_TOKEN',
  gemini: 'QUORUM_GEMINI_TOKEN',
  grok: 'QUORUM_GROK_API_KEY',
};

export async function statusCmd(): Promise<void> {
  console.log(pc.bold('Quorum status'));
  console.log('');

  const cfgCheck = await checkConfigPresent();
  if (!cfgCheck.ok) {
    console.log(pc.yellow('No quorum.config.yml in this directory.'));
    console.log(pc.dim('Run `quorum setup` to get started.'));
    return;
  }

  const config = await loadConfig('quorum.config.yml');
  console.log(`  mode:      ${pc.cyan(config.mode)}`);
  console.log(`  required:  ${config.agents.required.join(', ')}`);
  console.log(`  advisory:  ${config.agents.advisory.length ? config.agents.advisory.join(', ') : pc.dim('(none)')}`);
  console.log(`  blocking:  ${config.github.fail_check ? pc.green('yes (fails the check on disagreement)') : pc.yellow('no (advisory only)')}`);
  if (config.github.skip_label) console.log(`  skip label: ${pc.dim(config.github.skip_label)}`);
  if (config.github.only_label) console.log(`  only label: ${pc.dim(config.github.only_label)}`);
  console.log('');

  const flow = await Promise.all([
    checkWorkflowPresent(),
    checkBranchProtection(),
    ...[...config.agents.required, ...config.agents.advisory]
      .map(a => SECRET_FOR[a])
      .filter((s): s is string => Boolean(s))
      .map(s => checkRepoSecret(s)),
  ]);

  console.log(pc.bold('Repo state'));
  for (const c of flow) {
    const icon = c.ok ? pc.green('✓') : pc.red('✗');
    console.log(`  ${icon} ${c.name}${c.detail ? pc.dim(` — ${c.detail}`) : ''}`);
  }
}
