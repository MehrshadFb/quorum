#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { setupCmd } from './cli/setup.js';
import { initCmd } from './cli/init.js';
import { authCmd } from './cli/auth.js';
import { reviewCmd } from './cli/review.js';
import { doctorCmd } from './cli/doctor.js';
import { statusCmd } from './cli/status.js';

const program = new Command();

program
  .name('quorum')
  .description('Multi-AI consensus review for pull requests. No merges to main without unanimous AI approval.')
  .version('0.0.1')
  .action(async () => {
    await wrap(() => setupCmd({}));
  });

program
  .command('setup')
  .description('Guided one-shot setup: workflow + config + API keys (recommended)')
  .option('--yes', 'accept all defaults non-interactively (3-agent strict mode)', false)
  .option('--skip-auth', 'install workflow + config but don\'t walk through provider auth', false)
  .action(opts => wrap(() => setupCmd(opts)));

program
  .command('init')
  .description('Write workflow and config files (non-interactive)')
  .option('-f, --force', 'overwrite existing files', false)
  .action(opts => wrap(() => initCmd(opts)));

program
  .command('auth')
  .description('Set up provider API keys and push them to repo secrets')
  .option('--agent <name>', 'only set up a single agent (claude | codex | gemini | grok)')
  .option('--no-push', 'don\'t push secrets to GitHub, just print them')
  .action(opts => wrap(() => authCmd(opts)));

program
  .command('review')
  .description('Run configured agents against the current branch diff (local dry-run)')
  .option('-b, --base <ref>', 'base ref to diff against', 'main')
  .option('-c, --config <path>', 'config path', 'quorum.config.yml')
  .action(opts => wrap(() => reviewCmd(opts)));

program
  .command('doctor')
  .description('Diagnose missing prerequisites or misconfiguration')
  .action(() => wrap(doctorCmd));

program
  .command('status')
  .description('Show current quorum config and repo state')
  .action(() => wrap(statusCmd));

program.parseAsync(process.argv);

async function wrap(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(pc.red(`✗ ${(err as Error).message}`));
    process.exit(1);
  }
}
