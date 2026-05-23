import * as core from '@actions/core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENTS } from './agents/index.js';
import { renderDebatePrompt } from './prompt.js';
import { consensus, type Review, type ConsensusResult } from './consensus.js';
import type { QuorumConfig, AgentName } from './config.js';

const exec = promisify(execFile);

export const QUORUM_BOT_NAME = 'quorum-bot';
export const QUORUM_BOT_EMAIL = 'quorum-bot@users.noreply.github.com';

export interface RoundRecord {
  round: number;
  reviews: Review[];
}

export interface DeliberationOutcome {
  result: ConsensusResult;
  rounds: RoundRecord[];
  implementerCommitted: boolean;
  reachedMaxRounds: boolean;
}

export interface DeliberationInput {
  config: QuorumConfig;
  prompt: string;          // round 1 prompt (already rendered)
  title: string;
  description: string;
  diff: string;
  baseRef: string;         // base branch ref for counting bot commits
}

export async function deliberate(input: DeliberationInput): Promise<DeliberationOutcome> {
  const { config } = input;
  const toRun: AgentName[] = [...config.agents.required, ...config.agents.advisory];

  core.info(`Round 1: ${toRun.length} agents reviewing blind`);
  const round1: Review[] = await Promise.all(
    toRun.map(a => AGENTS[a].review({ prompt: input.prompt, options: config.agents.options[a] })),
  );

  let result = consensus(round1, config);
  const rounds: RoundRecord[] = [{ round: 1, reviews: round1 }];

  if (config.deliberation === 'silent' || result.decision === 'approve') {
    return wrap(result, rounds, false, false);
  }

  // Round 2: debate — each agent sees others' reviews
  core.info(`Round 2: debate — agents see each other's reviews`);
  const round2 = await runDebate(input, round1);
  result = consensus(round2, config);
  rounds.push({ round: 2, reviews: round2 });

  if (config.deliberation === 'debate' || result.decision === 'approve') {
    return wrap(result, rounds, false, false);
  }

  // collaborate: implementer commits fixes if rounds left
  const priorBotCommits = await botCommitCount(input.baseRef);
  const nextRound = priorBotCommits + 1;

  if (nextRound > config.deliberation_options.max_rounds) {
    core.warning(`Hit max_rounds=${config.deliberation_options.max_rounds}; escalating to human`);
    return wrap(
      {
        ...result,
        decision: 'needs_human',
        reason: `Hit max_rounds (${config.deliberation_options.max_rounds}) without consensus. ${result.reason}`,
      },
      rounds,
      false,
      true,
    );
  }

  // Convergence guard: if round1 and round2 had identical aggregate verdicts AND
  // no agent changed their stance, we're stuck. Don't waste an implementer call.
  if (!anyAgentChanged(round1, round2)) {
    const escalateAfter = config.deliberation_options.escalate_after_no_progress;
    if (nextRound > escalateAfter) {
      core.warning(`No agent changed their stance and we've passed escalate_after_no_progress=${escalateAfter}; escalating`);
      return wrap(
        {
          ...result,
          decision: 'needs_human',
          reason: `Agents are deadlocked (no stance changes across rounds). ${result.reason}`,
        },
        rounds,
        false,
        true,
      );
    }
  }

  core.info(`Collaborate: running implementer "${config.deliberation_options.implementer}" (will be round ${nextRound})`);
  const concerns = formatConcernsForImplementer(round2, config.agents.required);
  const { runImplementer } = await import('./implementer.js');
  const committed = await runImplementer({
    agent: config.deliberation_options.implementer,
    title: input.title,
    description: input.description,
    diff: input.diff,
    concernsBlock: concerns,
    config,
    round: nextRound,
  });

  if (committed) {
    return wrap(
      {
        ...result,
        decision: 'needs_human',
        reason: `Implementer (${config.deliberation_options.implementer}) pushed fixes for round ${nextRound}. The push will re-trigger Quorum.`,
      },
      rounds,
      true,
      false,
    );
  }

  return wrap(result, rounds, false, false);
}

function wrap(result: ConsensusResult, rounds: RoundRecord[], implementerCommitted: boolean, reachedMaxRounds: boolean): DeliberationOutcome {
  return { result, rounds, implementerCommitted, reachedMaxRounds };
}

async function runDebate(input: DeliberationInput, round1: Review[]): Promise<Review[]> {
  const { config } = input;
  const toRun: AgentName[] = [...config.agents.required, ...config.agents.advisory];

  return Promise.all(
    toRun.map(async agentName => {
      const own = round1.find(r => r.agent === agentName);
      const others = round1.filter(r => r.agent !== agentName);
      const prompt = renderDebatePrompt({
        round: 2,
        previousRound: 1,
        title: input.title,
        description: input.description,
        diff: input.diff,
        otherReviews: formatReviewsForPrompt(others),
        ownPreviousReview: own ? formatReviewForPrompt(own) : '(no previous review)',
      });
      try {
        return await AGENTS[agentName].review({ prompt, options: config.agents.options[agentName] });
      } catch (err) {
        return {
          agent: agentName,
          verdict: 'comment' as const,
          summary: '',
          concerns: [],
          suggestions: [],
          error: (err as Error).message,
        };
      }
    }),
  );
}

function anyAgentChanged(prev: Review[], next: Review[]): boolean {
  for (const r of next) {
    const old = prev.find(p => p.agent === r.agent);
    if (!old) continue;
    if (old.verdict !== r.verdict) return true;
    if (old.concerns.length !== r.concerns.length) return true;
  }
  return false;
}

function formatReviewsForPrompt(reviews: Review[]): string {
  if (reviews.length === 0) return '(no other reviews)';
  return reviews.map(formatReviewForPrompt).join('\n\n---\n\n');
}

function formatReviewForPrompt(r: Review): string {
  if (r.error) return `Agent: ${r.agent}\nError: ${r.error}\n(no usable review)`;
  const concerns = r.concerns.length
    ? r.concerns.map(c => `- [${c.severity}] ${c.file ? c.file + ':' + (c.line ?? '?') + ' — ' : ''}${c.message}`).join('\n')
    : '(none)';
  return `Agent: ${r.agent}\nVerdict: ${r.verdict}\nSummary: ${r.summary}\nConcerns:\n${concerns}`;
}

function formatConcernsForImplementer(reviews: Review[], required: AgentName[]): string {
  const items: string[] = [];
  for (const r of reviews) {
    if (!required.includes(r.agent)) continue;
    for (const c of r.concerns) {
      if (c.severity === 'minor') continue;
      const loc = c.file ? `${c.file}${c.line ? ':' + c.line : ''}` : '(no location)';
      items.push(`- [${c.severity}] ${loc} (raised by ${r.agent}): ${c.message}`);
    }
  }
  return items.length ? items.join('\n') : '(no blockers or majors — implementer should explain why this PR was blocked anyway)';
}

async function botCommitCount(baseRef: string): Promise<number> {
  try {
    const { stdout } = await exec('git', [
      'log',
      `--author=${QUORUM_BOT_EMAIL}`,
      '--oneline',
      `${baseRef}..HEAD`,
    ]);
    return stdout.split('\n').filter(s => s.trim()).length;
  } catch {
    return 0;
  }
}
