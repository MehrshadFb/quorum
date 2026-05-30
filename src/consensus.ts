import type { AgentName, QuorumConfig } from './config.js';

export type Verdict = 'approve' | 'request_changes' | 'comment';
export type Severity = 'blocker' | 'major' | 'minor';

export interface Concern {
  severity: Severity;
  file?: string;
  line?: number;
  message: string;
}

export interface Suggestion {
  file: string;
  line?: number;
  current?: string;
  proposed: string;
  rationale: string;
}

export interface Review {
  agent: AgentName;
  verdict: Verdict;
  summary: string;
  concerns: Concern[];
  suggestions: Suggestion[];
  error?: string;
}

export type Decision = 'approve' | 'request_changes' | 'needs_human';

export interface ConsensusResult {
  decision: Decision;
  reason: string;
  reviews: Review[];
  blockers: Array<Concern & { agent: AgentName }>;
}

export interface ErrorInfo {
  category: 'auth' | 'quota' | 'timeout' | 'setup' | 'trust' | 'parse' | 'unknown';
  label: string;
  hint?: string;
}

// Categorize agent error messages so PR comments show a friendly one-line
// label (with a fix hint) instead of dumping raw stderr.
export function classifyError(msg: string): ErrorInfo {
  if (/401|unauthorized|missing bearer|not logged in|no .*api[_-]?key|no .*oauth|no .*token/i.test(msg)) {
    return { category: 'auth', label: 'auth failed', hint: 'Check the agent\'s repo secret value (it may be empty, expired, or wrong type).' };
  }
  if (/429|quota|rate limit|exhausted|limit:\s*0/i.test(msg)) {
    return { category: 'quota', label: 'quota / rate limit', hint: 'Switch to a free-tier model in agents.options, or enable paid billing for this provider.' };
  }
  if (/timed? out/i.test(msg)) {
    return { category: 'timeout', label: 'timed out', hint: 'Raise agents.options.<name>.timeout_ms, or move the agent to advisory while you investigate.' };
  }
  if (/ENOENT|spawn .* failed|command not found|not installed/i.test(msg)) {
    return { category: 'setup', label: 'CLI not installed', hint: 'Make sure the workflow installs the agent\'s CLI before running quorum.' };
  }
  if (/trusted directory|--skip-trust/i.test(msg)) {
    return { category: 'trust', label: 'workspace not trusted', hint: 'Upgrade to a quorum version that passes --skip-trust to the CLI.' };
  }
  if (/unparseable|invalid verdict|json/i.test(msg)) {
    return { category: 'parse', label: 'returned malformed output', hint: 'Agent didn\'t return parseable JSON; the model may be ignoring the format instruction.' };
  }
  return { category: 'unknown', label: 'unexpected error' };
}

export function consensus(reviews: Review[], config: QuorumConfig): ConsensusResult {
  const requiredNames = config.agents.required;
  const requiredReviews = reviews.filter(r => requiredNames.includes(r.agent));
  const missing = requiredNames.filter(name => !requiredReviews.find(r => r.agent === name));

  if (missing.length > 0) {
    return {
      decision: 'needs_human',
      reason: `Missing reviews from required agents: ${missing.join(', ')}`,
      reviews,
      blockers: [],
    };
  }

  const errored = requiredReviews.filter(r => r.error);
  if (errored.length > 0) {
    const summaries = errored.map(r => `${r.agent} (${classifyError(r.error ?? '').label})`);
    const reason = errored.length === requiredReviews.length
      ? `All ${requiredReviews.length} required agents couldn't complete the review — see details below`
      : `${errored.length} of ${requiredReviews.length} required agents couldn't complete: ${summaries.join(', ')}`;
    return {
      decision: 'needs_human',
      reason,
      reviews,
      blockers: [],
    };
  }

  const blockers = requiredReviews.flatMap(r =>
    r.concerns
      .filter(c => c.severity === 'blocker')
      .map(c => ({ ...c, agent: r.agent })),
  );

  const approvals = requiredReviews.filter(r => r.verdict === 'approve');
  const total = requiredReviews.length;

  if (config.mode === 'strict') {
    if (approvals.length === total) {
      return {
        decision: 'approve',
        reason: `All ${total} required agents approve`,
        reviews,
        blockers,
      };
    }
    const dissenters = requiredReviews.filter(r => r.verdict !== 'approve').map(r => r.agent);
    return {
      decision: 'request_changes',
      reason: `${dissenters.length} of ${total} required agents request changes: ${dissenters.join(', ')}`,
      reviews,
      blockers,
    };
  }

  // majority mode (config validation guarantees ≥3 required agents)
  if (approvals.length * 2 > total) {
    return {
      decision: 'approve',
      reason: `${approvals.length} of ${total} required agents approve (majority)`,
      reviews,
      blockers,
    };
  }
  return {
    decision: 'request_changes',
    reason: `Only ${approvals.length} of ${total} required agents approve (majority not reached)`,
    reviews,
    blockers,
  };
}

export function formatComment(result: ConsensusResult, config: QuorumConfig): string {
  const lines: string[] = [];
  const emoji = result.decision === 'approve' ? '✅' : result.decision === 'request_changes' ? '🛑' : '⚠️';

  lines.push(`## ${emoji} Quorum review — ${result.decision.replace('_', ' ')}`);
  lines.push('');
  lines.push(`**${result.reason}**`);
  lines.push('');
  lines.push(`_Mode: \`${config.mode}\` · Required: ${config.agents.required.join(', ')}${config.agents.advisory.length ? ` · Advisory: ${config.agents.advisory.join(', ')}` : ''}_`);
  lines.push('');

  if (result.blockers.length > 0) {
    lines.push('### Blocking concerns');
    for (const b of result.blockers) {
      const loc = b.file ? ` \`${b.file}${b.line ? ':' + b.line : ''}\`` : '';
      lines.push(`- **${b.agent}**${loc}: ${b.message}`);
    }
    lines.push('');
  }

  lines.push('### Per-agent verdicts');
  for (const r of result.reviews) {
    const isRequired = config.agents.required.includes(r.agent);
    const role = isRequired ? 'required' : 'advisory';

    if (r.error) {
      const info = classifyError(r.error);
      lines.push('');
      lines.push(`<details><summary>⚠️ <strong>${r.agent}</strong> (${role}) — ${info.label}</summary>`);
      lines.push('');
      if (info.hint) {
        lines.push(`> 💡 ${info.hint}`);
        lines.push('');
      }
      lines.push('```');
      lines.push(r.error);
      lines.push('```');
      lines.push('</details>');
      continue;
    }

    const vEmoji = r.verdict === 'approve' ? '✅' : r.verdict === 'request_changes' ? '🛑' : '💬';
    lines.push('');
    lines.push(`<details><summary>${vEmoji} <strong>${r.agent}</strong> (${role}) — ${r.verdict}</summary>`);
    lines.push('');
    if (r.summary) {
      lines.push(r.summary);
      lines.push('');
    }
    if (r.concerns.length > 0) {
      lines.push('**Concerns:**');
      for (const c of r.concerns) {
        const loc = c.file ? ` \`${c.file}${c.line ? ':' + c.line : ''}\`` : '';
        lines.push(`- _${c.severity}_${loc}: ${c.message}`);
      }
      lines.push('');
    }
    if (r.suggestions.length > 0) {
      lines.push('**Suggestions:**');
      for (const s of r.suggestions) {
        lines.push(`- \`${s.file}${s.line ? ':' + s.line : ''}\` — ${s.rationale}`);
        if (s.current && s.proposed) {
          lines.push('  ```diff');
          for (const ln of s.current.split('\n')) lines.push(`  - ${ln}`);
          for (const ln of s.proposed.split('\n')) lines.push(`  + ${ln}`);
          lines.push('  ```');
        }
      }
      lines.push('');
    }
    lines.push('</details>');
  }

  lines.push('');
  lines.push('---');
  lines.push('_Generated by [quorum](https://github.com/MehrshadFb/quorum). Edit `quorum.config.yml` to change required agents or mode._');
  return lines.join('\n');
}

