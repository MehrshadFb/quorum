import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

export type AgentName = 'claude' | 'codex' | 'gemini' | 'grok';
export type Mode = 'strict' | 'majority';
export type Deliberation = 'silent' | 'debate' | 'collaborate';

export interface AgentOptions {
  model?: string;
  timeout_ms?: number;
}

export interface DeliberationOptions {
  max_rounds: number;
  implementer: AgentName;
  bot_token_secret: string;
  escalate_after_no_progress: number;
}

export interface QuorumConfig {
  agents: {
    required: AgentName[];
    advisory: AgentName[];
    options: Partial<Record<AgentName, AgentOptions>>;
  };
  mode: Mode;
  deliberation: Deliberation;
  deliberation_options: DeliberationOptions;
  github: {
    post_comments: boolean;
    request_changes: boolean;
    fail_check: boolean;
    skip_label: string | null;
    only_label: string | null;
  };
  review: {
    max_diff_bytes: number;
    skip_paths: string[];
    custom_prompt_path: string | null;
  };
}

export const KNOWN_AGENTS: readonly AgentName[] = ['claude', 'codex', 'gemini', 'grok'];

export const DEFAULT_CONFIG: QuorumConfig = {
  agents: {
    required: ['claude', 'codex', 'gemini'],
    advisory: [],
    options: {},
  },
  mode: 'strict',
  deliberation: 'silent',
  deliberation_options: {
    max_rounds: 3,
    implementer: 'claude',
    bot_token_secret: 'QUORUM_BOT_TOKEN',
    escalate_after_no_progress: 2,
  },
  github: {
    post_comments: true,
    request_changes: true,
    fail_check: true,
    skip_label: 'skip-quorum',
    only_label: null,
  },
  review: {
    max_diff_bytes: 200_000,
    skip_paths: [],
    custom_prompt_path: null,
  },
};

export async function loadConfig(path: string): Promise<QuorumConfig> {
  const raw = await readFile(path, 'utf8');
  const parsed = parse(raw) ?? {};
  return validate(parsed);
}

export function validate(raw: unknown): QuorumConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('quorum.config.yml must be an object');
  }
  const r = raw as Record<string, unknown>;
  const agents = (r.agents ?? {}) as Record<string, unknown>;
  const required = asAgentList(agents.required ?? DEFAULT_CONFIG.agents.required, 'agents.required');
  const advisory = asAgentList(agents.advisory ?? [], 'agents.advisory');
  const options = asAgentOptions(agents.options ?? {});
  const mode = asMode(r.mode ?? 'strict');

  if (required.length < 2) {
    throw new Error(`agents.required must list at least 2 agents (quorum needs ≥2). Got: ${required.length}`);
  }
  if (mode === 'majority' && required.length < 3) {
    throw new Error(`mode: majority requires at least 3 required agents (for a tiebreaker). Got: ${required.length}`);
  }
  for (const a of advisory) {
    if (required.includes(a)) {
      throw new Error(`Agent "${a}" cannot be both required and advisory`);
    }
  }

  const gh = (r.github ?? {}) as Record<string, unknown>;
  const review = (r.review ?? {}) as Record<string, unknown>;
  const deliberation = asDeliberation(r.deliberation ?? 'silent');
  const delibOptsRaw = (r.deliberation_options ?? {}) as Record<string, unknown>;
  const implementer = typeof delibOptsRaw.implementer === 'string' && KNOWN_AGENTS.includes(delibOptsRaw.implementer as AgentName)
    ? delibOptsRaw.implementer as AgentName
    : DEFAULT_CONFIG.deliberation_options.implementer;

  if (deliberation === 'collaborate' && !required.includes(implementer) && !advisory.includes(implementer)) {
    throw new Error(`deliberation_options.implementer "${implementer}" must also appear in agents.required or agents.advisory`);
  }

  const deliberationOptions: DeliberationOptions = {
    max_rounds: typeof delibOptsRaw.max_rounds === 'number' ? delibOptsRaw.max_rounds : DEFAULT_CONFIG.deliberation_options.max_rounds,
    implementer,
    bot_token_secret: typeof delibOptsRaw.bot_token_secret === 'string' ? delibOptsRaw.bot_token_secret : DEFAULT_CONFIG.deliberation_options.bot_token_secret,
    escalate_after_no_progress: typeof delibOptsRaw.escalate_after_no_progress === 'number' ? delibOptsRaw.escalate_after_no_progress : DEFAULT_CONFIG.deliberation_options.escalate_after_no_progress,
  };

  return {
    agents: { required, advisory, options },
    mode,
    deliberation,
    deliberation_options: deliberationOptions,
    github: {
      post_comments: gh.post_comments !== false,
      request_changes: gh.request_changes !== false,
      fail_check: gh.fail_check !== false,
      skip_label: typeof gh.skip_label === 'string' ? gh.skip_label : (gh.skip_label === null ? null : DEFAULT_CONFIG.github.skip_label),
      only_label: typeof gh.only_label === 'string' ? gh.only_label : null,
    },
    review: {
      max_diff_bytes: typeof review.max_diff_bytes === 'number' ? review.max_diff_bytes : DEFAULT_CONFIG.review.max_diff_bytes,
      skip_paths: Array.isArray(review.skip_paths) ? review.skip_paths.filter((x): x is string => typeof x === 'string') : [],
      custom_prompt_path: typeof review.custom_prompt_path === 'string' ? review.custom_prompt_path : null,
    },
  };
}

function asAgentList(v: unknown, field: string): AgentName[] {
  if (!Array.isArray(v)) throw new Error(`${field} must be an array`);
  const out: AgentName[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || !KNOWN_AGENTS.includes(item as AgentName)) {
      throw new Error(`${field}: unknown agent "${item}". Known: ${KNOWN_AGENTS.join(', ')}`);
    }
    if (out.includes(item as AgentName)) {
      throw new Error(`${field}: duplicate agent "${item}"`);
    }
    out.push(item as AgentName);
  }
  return out;
}

function asAgentOptions(v: unknown): Partial<Record<AgentName, AgentOptions>> {
  if (typeof v !== 'object' || v === null) return {};
  const out: Partial<Record<AgentName, AgentOptions>> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!KNOWN_AGENTS.includes(k as AgentName)) continue;
    if (typeof raw !== 'object' || raw === null) continue;
    const o = raw as Record<string, unknown>;
    out[k as AgentName] = {
      model: typeof o.model === 'string' ? o.model : undefined,
      timeout_ms: typeof o.timeout_ms === 'number' ? o.timeout_ms : undefined,
    };
  }
  return out;
}

function asMode(v: unknown): Mode {
  if (v === 'strict' || v === 'majority') return v;
  throw new Error(`mode must be "strict" or "majority", got "${String(v)}"`);
}

function asDeliberation(v: unknown): Deliberation {
  if (v === 'silent' || v === 'debate' || v === 'collaborate') return v;
  throw new Error(`deliberation must be "silent", "debate", or "collaborate", got "${String(v)}"`);
}
