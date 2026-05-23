import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, DEFAULT_CONFIG } from './config.js';

// These tests cover the config-level deliberation knobs. The runtime
// orchestrator in deliberation.ts shells out to agents + git, so it's tested
// integration-style by the action itself in CI.

test('deliberation defaults to "silent" when omitted', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex', 'gemini'] },
    mode: 'strict',
  });
  assert.equal(cfg.deliberation, 'silent');
});

test('deliberation: "debate" is accepted', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex', 'gemini'] },
    mode: 'strict',
    deliberation: 'debate',
  });
  assert.equal(cfg.deliberation, 'debate');
});

test('deliberation: "collaborate" is accepted', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex', 'gemini'] },
    mode: 'strict',
    deliberation: 'collaborate',
    deliberation_options: { implementer: 'claude' },
  });
  assert.equal(cfg.deliberation, 'collaborate');
  assert.equal(cfg.deliberation_options.implementer, 'claude');
});

test('deliberation: rejects an unknown value', () => {
  assert.throws(
    () => validate({
      agents: { required: ['claude', 'codex'] },
      mode: 'strict',
      deliberation: 'shouting-match',
    }),
    /silent.*debate.*collaborate/,
  );
});

test('collaborate: implementer must appear in required or advisory', () => {
  assert.throws(
    () => validate({
      agents: { required: ['claude', 'codex'] },
      mode: 'strict',
      deliberation: 'collaborate',
      deliberation_options: { implementer: 'gemini' },
    }),
    /implementer.*gemini.*required.*advisory/,
  );
});

test('collaborate: implementer in advisory is allowed', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex'], advisory: ['gemini'] },
    mode: 'strict',
    deliberation: 'collaborate',
    deliberation_options: { implementer: 'gemini' },
  });
  assert.equal(cfg.deliberation_options.implementer, 'gemini');
});

test('deliberation_options has sensible defaults', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex', 'gemini'] },
    mode: 'strict',
    deliberation: 'collaborate',
  });
  assert.equal(cfg.deliberation_options.max_rounds, DEFAULT_CONFIG.deliberation_options.max_rounds);
  assert.equal(cfg.deliberation_options.bot_token_secret, 'QUORUM_BOT_TOKEN');
  assert.equal(cfg.deliberation_options.escalate_after_no_progress, 2);
});

test('deliberation_options.max_rounds is overridable', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex', 'gemini'] },
    mode: 'strict',
    deliberation: 'collaborate',
    deliberation_options: { max_rounds: 5 },
  });
  assert.equal(cfg.deliberation_options.max_rounds, 5);
});

test('silent + strict still works (existing behavior unchanged)', () => {
  const cfg = validate({
    agents: { required: ['claude', 'codex'] },
    mode: 'strict',
    deliberation: 'silent',
  });
  assert.equal(cfg.deliberation, 'silent');
  assert.equal(cfg.mode, 'strict');
});
