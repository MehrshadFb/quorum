import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, type QuorumConfig } from './config.js';

test('accepts a minimal valid config', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex'] },
    mode: 'strict',
  });
  assert.deepEqual(cfg.agents.required, ['claude', 'codex']);
  assert.equal(cfg.mode, 'strict');
  // Defaults applied:
  assert.equal(cfg.github.fail_check, true);
  assert.equal(cfg.review.max_diff_bytes, 50_000);
});

test('rejects fewer than 2 required agents', () => {
  assert.throws(
    () => validate({ agents: { required: ['claude'] }, mode: 'strict' }),
    /at least 2 agents/,
  );
});

test('rejects majority mode with fewer than 3 required agents', () => {
  assert.throws(
    () => validate({ agents: { required: ['claude', 'codex'] }, mode: 'majority' }),
    /at least 3 required/,
  );
});

test('accepts majority mode with exactly 3 required', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex', 'gemini'] },
    mode: 'majority',
  });
  assert.equal(cfg.mode, 'majority');
});

test('rejects an unknown agent name', () => {
  assert.throws(
    () => validate({ agents: { required: ['claude', 'fakeagent'] }, mode: 'strict' }),
    /unknown agent/,
  );
});

test('rejects duplicate agents in the same list', () => {
  assert.throws(
    () => validate({ agents: { required: ['claude', 'claude'] }, mode: 'strict' }),
    /duplicate agent/,
  );
});

test('rejects an agent that is both required and advisory', () => {
  assert.throws(
    () => validate({
      agents: { required: ['claude', 'codex', 'gemini'], advisory: ['claude'] },
      mode: 'strict',
    }),
    /both required and advisory/,
  );
});

test('rejects an invalid mode', () => {
  assert.throws(
    () => validate({ agents: { required: ['claude', 'codex'] }, mode: 'consensus' }),
    /strict.*majority/,
  );
});

test('per-agent options are parsed', () => {
  const cfg = validate({
    agents: {
      required: ['claude', 'codex', 'gemini'],
      options: {
        claude: { model: 'claude-opus-4-7', timeout_ms: 60000 },
        grok: { model: 'grok-4-latest' },
      },
    },
    mode: 'strict',
  });
  assert.equal(cfg.agents.options.claude?.model, 'claude-opus-4-7');
  assert.equal(cfg.agents.options.claude?.timeout_ms, 60000);
  assert.equal(cfg.agents.options.grok?.model, 'grok-4-latest');
});

test('skip_label defaults to "skip-quorum"', () => {
  const cfg = validate({ agents: { required: ['claude', 'codex'] }, mode: 'strict' });
  assert.equal(cfg.github.skip_label, 'skip-quorum');
});

test('skip_label can be explicitly disabled with null', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex'] },
    mode: 'strict',
    github: { skip_label: null },
  });
  assert.equal(cfg.github.skip_label, null);
});

test('fail_check: false produces an advisory-only config', () => {
  const cfg: QuorumConfig = validate({
    agents: { required: ['claude', 'codex'] },
    mode: 'strict',
    github: { fail_check: false },
  });
  assert.equal(cfg.github.fail_check, false);
});

test('skip_paths are read as a string array', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex'] },
    mode: 'strict',
    review: { skip_paths: ['*.md', 'docs/**', 42] },
  });
  // Non-strings are filtered out.
  assert.deepEqual(cfg.review.skip_paths, ['*.md', 'docs/**']);
});
