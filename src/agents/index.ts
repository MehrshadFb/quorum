import type { AgentName } from '../config.js';
import type { AgentRunner } from './util.js';
import { claude } from './claude.js';
import { codex } from './codex.js';
import { gemini } from './gemini.js';
import { grok } from './grok.js';

export const AGENTS: Record<AgentName, AgentRunner> = {
  claude,
  codex,
  gemini,
  grok,
};

export type { AgentRunner } from './util.js';
