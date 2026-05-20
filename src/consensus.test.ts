import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consensus, type Review } from './consensus.js';
import { DEFAULT_CONFIG, type QuorumConfig } from './config.js';

function approve(agent: 'claude' | 'codex' | 'gemini' | 'grok'): Review {
  return { agent, verdict: 'approve', summary: 'lgtm', concerns: [], suggestions: [] };
}

function requestChanges(agent: 'claude' | 'codex' | 'gemini' | 'grok', concernMsg = 'something is wrong'): Review {
  return {
    agent,
    verdict: 'request_changes',
    summary: 'has issues',
    concerns: [{ severity: 'major', message: concernMsg }],
    suggestions: [],
  };
}

function blocker(agent: 'claude' | 'codex' | 'gemini' | 'grok', msg: string): Review {
  return {
    agent,
    verdict: 'request_changes',
    summary: 'has blocker',
    concerns: [{ severity: 'blocker', message: msg, file: 'src/foo.ts', line: 42 }],
    suggestions: [],
  };
}

function errored(agent: 'claude' | 'codex' | 'gemini' | 'grok', err = 'timeout'): Review {
  return {
    agent,
    verdict: 'comment',
    summary: '',
    concerns: [],
    suggestions: [],
    error: err,
  };
}

const STRICT_3: QuorumConfig = {
  ...DEFAULT_CONFIG,
  agents: { required: ['claude', 'codex', 'gemini'], advisory: [], options: {} },
  mode: 'strict',
};

const MAJORITY_3: QuorumConfig = { ...STRICT_3, mode: 'majority' };

const STRICT_3_WITH_ADVISORY: QuorumConfig = {
  ...DEFAULT_CONFIG,
  agents: { required: ['claude', 'codex', 'gemini'], advisory: ['grok'], options: {} },
  mode: 'strict',
};

test('strict: all approve → approve', () => {
  const r = consensus([approve('claude'), approve('codex'), approve('gemini')], STRICT_3);
  assert.equal(r.decision, 'approve');
  assert.match(r.reason, /All 3/);
});

test('strict: one requests changes → request_changes', () => {
  const r = consensus([approve('claude'), approve('codex'), requestChanges('gemini')], STRICT_3);
  assert.equal(r.decision, 'request_changes');
  assert.match(r.reason, /gemini/);
});

test('strict: none approve → request_changes', () => {
  const r = consensus(
    [requestChanges('claude'), requestChanges('codex'), requestChanges('gemini')],
    STRICT_3,
  );
  assert.equal(r.decision, 'request_changes');
});

test('strict: a "comment" verdict from a required agent counts as not-approve', () => {
  const commentOnly: Review = {
    agent: 'gemini', verdict: 'comment', summary: 'nits', concerns: [], suggestions: [],
  };
  const r = consensus([approve('claude'), approve('codex'), commentOnly], STRICT_3);
  assert.equal(r.decision, 'request_changes');
});

test('missing required agent → needs_human', () => {
  const r = consensus([approve('claude'), approve('codex')], STRICT_3);
  assert.equal(r.decision, 'needs_human');
  assert.match(r.reason, /gemini/);
});

test('errored required agent → needs_human', () => {
  const r = consensus([approve('claude'), approve('codex'), errored('gemini', 'cli crashed')], STRICT_3);
  assert.equal(r.decision, 'needs_human');
  assert.match(r.reason, /gemini.*cli crashed/);
});

test('blockers are tagged with the agent that raised them', () => {
  const r = consensus(
    [
      blocker('claude', 'leaks secrets'),
      approve('codex'),
      blocker('gemini', 'breaks API'),
    ],
    STRICT_3,
  );
  assert.equal(r.decision, 'request_changes');
  assert.equal(r.blockers.length, 2);
  assert.deepEqual(r.blockers.map(b => b.agent).sort(), ['claude', 'gemini']);
  assert.ok(r.blockers.some(b => b.message === 'leaks secrets'));
});

test('majority: 2-of-3 approve → approve', () => {
  const r = consensus(
    [approve('claude'), approve('codex'), requestChanges('gemini')],
    MAJORITY_3,
  );
  assert.equal(r.decision, 'approve');
  assert.match(r.reason, /2 of 3.*majority/);
});

test('majority: 1-of-3 approve → request_changes', () => {
  const r = consensus(
    [approve('claude'), requestChanges('codex'), requestChanges('gemini')],
    MAJORITY_3,
  );
  assert.equal(r.decision, 'request_changes');
});

test('advisory agents do not block when they dissent', () => {
  const r = consensus(
    [approve('claude'), approve('codex'), approve('gemini'), requestChanges('grok')],
    STRICT_3_WITH_ADVISORY,
  );
  assert.equal(r.decision, 'approve');
});

test('advisory agents do not block when they error', () => {
  const r = consensus(
    [approve('claude'), approve('codex'), approve('gemini'), errored('grok')],
    STRICT_3_WITH_ADVISORY,
  );
  assert.equal(r.decision, 'approve');
});

test('advisory agents are still included in the returned reviews list', () => {
  const r = consensus(
    [approve('claude'), approve('codex'), approve('gemini'), requestChanges('grok', 'nit')],
    STRICT_3_WITH_ADVISORY,
  );
  assert.equal(r.reviews.length, 4);
  assert.ok(r.reviews.some(rev => rev.agent === 'grok'));
});

test('only blockers (not majors/minors) appear in the blockers array', () => {
  const r = consensus(
    [
      blocker('claude', 'critical'),
      {
        agent: 'codex',
        verdict: 'request_changes',
        summary: 'minor nits',
        concerns: [
          { severity: 'major', message: 'major thing' },
          { severity: 'minor', message: 'tiny thing' },
        ],
        suggestions: [],
      },
      approve('gemini'),
    ],
    STRICT_3,
  );
  assert.equal(r.blockers.length, 1);
  assert.equal(r.blockers[0]?.severity, 'blocker');
});
