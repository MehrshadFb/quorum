import pc from 'picocolors';
import { loadConfig } from '../config.js';
import { localDiff, truncateDiff } from '../diff.js';
import { renderPrompt } from '../prompt.js';
import { AGENTS } from '../agents/index.js';
import { consensus, type Review } from '../consensus.js';

interface ReviewOpts {
  base?: string;
  config?: string;
}

export async function reviewCmd(opts: ReviewOpts): Promise<void> {
  const config = await loadConfig(opts.config ?? 'quorum.config.yml');
  const base = opts.base ?? 'main';

  console.log(pc.bold(`Quorum local review — base: ${base}, mode: ${config.mode}`));
  console.log(pc.dim(`required: ${config.agents.required.join(', ')}  advisory: ${config.agents.advisory.join(', ') || '(none)'}`));
  console.log('');

  const ctx = truncateDiff(await localDiff(base), config.review.max_diff_bytes);
  if (ctx.truncated) console.log(pc.yellow(`diff truncated to ${config.review.max_diff_bytes} bytes`));
  if (!ctx.diff) {
    console.log(pc.yellow('empty diff — nothing to review'));
    return;
  }
  console.log(pc.dim(`diff: ${ctx.bytes} bytes`));

  const prompt = renderPrompt(ctx);
  const toRun = [...config.agents.required, ...config.agents.advisory];
  console.log(pc.dim(`running ${toRun.length} agents...`));
  console.log('');

  const reviews: Review[] = await Promise.all(
    toRun.map(name => AGENTS[name].review({ prompt, options: config.agents.options[name] })),
  );

  for (const r of reviews) {
    const role = config.agents.required.includes(r.agent) ? 'required' : 'advisory';
    if (r.error) {
      console.log(pc.red(`  ✗ ${r.agent} (${role}) — error: ${r.error}`));
    } else {
      const v = r.verdict === 'approve' ? pc.green('approve')
        : r.verdict === 'request_changes' ? pc.red('request_changes')
        : pc.yellow('comment');
      console.log(`  • ${pc.bold(r.agent)} (${role}) — ${v}  ${pc.dim(`(${r.concerns.length} concerns, ${r.suggestions.length} suggestions)`)}`);
      if (r.summary) console.log(`    ${pc.dim(r.summary)}`);
      for (const c of r.concerns) {
        const loc = c.file ? ` ${c.file}${c.line ? ':' + c.line : ''}` : '';
        console.log(`    [${c.severity}]${loc}: ${c.message}`);
      }
    }
  }
  console.log('');

  const result = consensus(reviews, config);
  const dEmoji = result.decision === 'approve' ? pc.green('✓ approve')
    : result.decision === 'request_changes' ? pc.red('✗ request_changes')
    : pc.yellow('? needs_human');
  console.log(pc.bold(`Decision: ${dEmoji}`));
  console.log(`  ${result.reason}`);

  if (result.decision !== 'approve') process.exitCode = 1;
}
