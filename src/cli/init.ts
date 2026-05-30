import { mkdir, copyFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';

interface InitOpts {
  force?: boolean;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = join(HERE, '..', '..', 'template');

const FILES_TO_COPY: Array<{ from: string; to: string }> = [
  { from: '.github/workflows/quorum.yml', to: '.github/workflows/quorum.yml' },
  { from: 'quorum.config.yml', to: 'quorum.config.yml' },
];

export async function initCmd(opts: InitOpts): Promise<void> {
  const cwd = process.cwd();
  console.log(pc.bold(`Installing quorum files into ${cwd}`));

  for (const f of FILES_TO_COPY) {
    const src = join(TEMPLATE_ROOT, f.from);
    const dest = join(cwd, f.to);
    await mkdir(dirname(dest), { recursive: true });

    if (!opts.force && await exists(dest)) {
      console.log(pc.yellow(`  skip   ${f.to} (exists; pass --force to overwrite)`));
      continue;
    }
    await copyFile(src, dest);
    console.log(pc.green(`  write  ${f.to}`));
  }

  console.log('');
  console.log(pc.bold('Next steps'));
  console.log(`  1. Edit ${pc.cyan('quorum.config.yml')} — pick required agents and mode.`);
  console.log(`  2. Run  ${pc.cyan('quorum auth')} — set up provider API keys.`);
  console.log(`  3. Run  ${pc.cyan('quorum doctor')} — verify everything is wired up.`);
  console.log(`  4. Open a PR and watch Quorum vote.`);
  console.log('');
  console.log(pc.dim('Or skip the manual steps — run `quorum setup` for guided onboarding.'));
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
