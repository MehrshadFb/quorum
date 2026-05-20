import * as core from '@actions/core';
import { context } from '@actions/github';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { getPRContext, octokit, upsertComment, postReview } from './github.js';
import { truncateDiff } from './diff.js';
import { renderPrompt, REVIEW_PROMPT_TEMPLATE } from './prompt.js';
import { deliberate, type RoundRecord } from './deliberation.js';
import { formatComment, type ConsensusResult } from './consensus.js';
import type { QuorumConfig } from './config.js';

async function main(): Promise<void> {
  const configPath = core.getInput('config-path') || 'quorum.config.yml';
  const config = await loadConfig(configPath);

  core.info(`Loaded config: mode=${config.mode} deliberation=${config.deliberation} required=[${config.agents.required.join(', ')}] advisory=[${config.agents.advisory.join(', ')}]`);

  const pr = await getPRContext();
  core.info(`PR #${pr.number}: "${pr.title}" (${pr.bytes} diff bytes)`);

  const labels = (context.payload.pull_request?.labels ?? []).map((l: { name: string }) => l.name);
  if (config.github.skip_label && labels.includes(config.github.skip_label)) {
    core.info(`Skipping: PR is labeled "${config.github.skip_label}"`);
    return;
  }
  if (config.github.only_label && !labels.includes(config.github.only_label)) {
    core.info(`Skipping: PR is not labeled "${config.github.only_label}"`);
    return;
  }

  if (config.review.skip_paths.length > 0) {
    const changed = await listChangedFiles(pr.number);
    const allSkippable = changed.length > 0 && changed.every(f => matchesAny(f, config.review.skip_paths));
    if (allSkippable) {
      core.info(`Skipping: all ${changed.length} changed files match skip_paths`);
      return;
    }
  }

  const ctx = truncateDiff(pr, config.review.max_diff_bytes);
  if (ctx.truncated) core.warning(`Diff truncated to ${config.review.max_diff_bytes} bytes`);

  const promptTemplate = await loadPromptTemplate(config.review.custom_prompt_path);
  const round1Prompt = renderPrompt({ title: ctx.title, description: ctx.description, diff: ctx.diff }, promptTemplate);

  const baseRef = context.payload.pull_request?.base?.ref ?? 'main';

  const outcome = await deliberate({
    config,
    prompt: round1Prompt,
    title: ctx.title,
    description: ctx.description,
    diff: ctx.diff,
    baseRef: `origin/${baseRef}`,
  });

  for (const round of outcome.rounds) {
    for (const r of round.reviews) {
      if (r.error) core.warning(`round ${round.round} — agent ${r.agent} errored: ${r.error}`);
      else core.info(`round ${round.round} — ${r.agent}: ${r.verdict} (concerns=${r.concerns.length}, suggestions=${r.suggestions.length})`);
    }
  }
  core.info(`Decision: ${outcome.result.decision} — ${outcome.result.reason}`);

  const body = buildBody(outcome.rounds, outcome.result, config);

  if (config.github.post_comments) {
    await upsertComment(pr.number, body);
  }

  if (config.github.request_changes && !outcome.implementerCommitted) {
    const event = outcome.result.decision === 'approve' ? 'APPROVE'
      : outcome.result.decision === 'request_changes' ? 'REQUEST_CHANGES'
      : 'COMMENT';
    try {
      await postReview(pr.number, event, outcome.result.reason);
    } catch (err) {
      core.warning(`Couldn't post review (token may lack permission, or you can't review your own PR): ${(err as Error).message}`);
    }
  }

  core.setOutput('decision', outcome.result.decision);
  core.setOutput('reason', outcome.result.reason);
  core.setOutput('blockers', String(outcome.result.blockers.length));
  core.setOutput('implementer_committed', String(outcome.implementerCommitted));
  core.setOutput('rounds_run', String(outcome.rounds.length));

  // When the implementer commits, the push will re-trigger the workflow.
  // We exit success on this run so the next run is the source of truth.
  if (outcome.implementerCommitted) {
    core.info('Implementer pushed fixes; exiting success so the push-triggered run is the next round.');
    return;
  }

  if (config.github.fail_check) {
    if (outcome.result.decision === 'request_changes') {
      core.setFailed(`Quorum blocked: ${outcome.result.reason}`);
    } else if (outcome.result.decision === 'needs_human') {
      core.setFailed(`Quorum could not decide: ${outcome.result.reason}`);
    }
  }
}

function buildBody(rounds: RoundRecord[], result: ConsensusResult, config: QuorumConfig): string {
  // Render the standard comment from the LAST round's reviews (most authoritative).
  const last = rounds[rounds.length - 1]!;
  const main = formatComment({ ...result, reviews: last.reviews }, config);

  if (rounds.length === 1) return main;

  // Append a "Round history" section so the human can see the deliberation.
  const history: string[] = ['', '---', '', '### Deliberation history'];
  for (const r of rounds) {
    history.push(`<details><summary><strong>Round ${r.round}</strong> — ${r.reviews.map(rev => `${rev.agent}:${rev.error ? 'err' : rev.verdict}`).join(', ')}</summary>`);
    history.push('');
    for (const rev of r.reviews) {
      const v = rev.error ? `error: ${rev.error}` : rev.verdict;
      history.push(`- **${rev.agent}** — ${v}${rev.summary ? `: _${rev.summary}_` : ''}`);
    }
    history.push('');
    history.push('</details>');
  }
  return main + '\n' + history.join('\n');
}

async function loadPromptTemplate(customPath: string | null): Promise<string> {
  if (!customPath) return REVIEW_PROMPT_TEMPLATE;
  try {
    return await readFile(customPath, 'utf8');
  } catch (err) {
    core.warning(`Couldn't read custom prompt at ${customPath} — using default. (${(err as Error).message})`);
    return REVIEW_PROMPT_TEMPLATE;
  }
}

async function listChangedFiles(prNumber: number): Promise<string[]> {
  const kit = octokit();
  const files = await kit.paginate(kit.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return files.map(f => f.filename);
}

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some(p => globMatch(file, p));
}

function globMatch(file: string, pattern: string): boolean {
  const rx = '^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '<<DOUBLE>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<DOUBLE>>/g, '(?:.*/)?')
    .replace(/\?/g, '[^/]') + '$';
  return new RegExp(rx).test(file);
}

main().catch(err => {
  core.setFailed(`quorum action crashed: ${err.message}`);
});
