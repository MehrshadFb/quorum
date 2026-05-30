import { spawn } from 'node:child_process';
import type { AgentName, AgentOptions } from '../config.js';
import type { Review, Verdict, Concern, Suggestion } from '../consensus.js';

export interface AgentInput {
  prompt: string;
  options?: AgentOptions;
}

export interface AgentRunner {
  readonly name: AgentName;
  review(input: AgentInput): Promise<Review>;
}

export function parseAgentJSON(raw: string, agent: AgentName): Review {
  const cleaned = stripFences(raw).trim();
  const jsonString = extractJSONObject(cleaned);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(`agent "${agent}" returned unparseable JSON: ${(err as Error).message}. Raw start: ${raw.slice(0, 200)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`agent "${agent}" returned non-object JSON`);
  }
  const p = parsed as Record<string, unknown>;

  // Some CLIs wrap the model output in an envelope like {"result": "..."} — peel that.
  if (typeof p.result === 'string' && p.verdict === undefined) {
    return parseAgentJSON(p.result, agent);
  }

  const verdict = asVerdict(p.verdict, agent);
  const summary = typeof p.summary === 'string' ? p.summary : '';
  const concerns = Array.isArray(p.concerns) ? p.concerns.map(c => asConcern(c, agent)).filter(Boolean) as Concern[] : [];
  const suggestions = Array.isArray(p.suggestions) ? p.suggestions.map(s => asSuggestion(s)).filter(Boolean) as Suggestion[] : [];

  return { agent, verdict, summary, concerns, suggestions };
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
}

function extractJSONObject(s: string): string {
  const start = s.indexOf('{');
  if (start === -1) return s;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

function asVerdict(v: unknown, agent: AgentName): Verdict {
  if (v === 'approve' || v === 'request_changes' || v === 'comment') return v;
  throw new Error(`agent "${agent}" returned invalid verdict: ${String(v)}`);
}

function asConcern(c: unknown, _agent: AgentName): Concern | null {
  if (typeof c !== 'object' || c === null) return null;
  const o = c as Record<string, unknown>;
  const severity = o.severity;
  if (severity !== 'blocker' && severity !== 'major' && severity !== 'minor') return null;
  const message = typeof o.message === 'string' ? o.message : '';
  if (!message) return null;
  return {
    severity,
    message,
    file: typeof o.file === 'string' ? o.file : undefined,
    line: typeof o.line === 'number' ? o.line : undefined,
  };
}

function asSuggestion(s: unknown): Suggestion | null {
  if (typeof s !== 'object' || s === null) return null;
  const o = s as Record<string, unknown>;
  const file = typeof o.file === 'string' ? o.file : '';
  const proposed = typeof o.proposed === 'string' ? o.proposed : '';
  const rationale = typeof o.rationale === 'string' ? o.rationale : '';
  if (!file || !proposed) return null;
  return {
    file,
    proposed,
    rationale,
    line: typeof o.line === 'number' ? o.line : undefined,
    current: typeof o.current === 'string' ? o.current : undefined,
  };
}

// Strips ANSI escape codes (color, cursor moves) so error messages render
// cleanly in markdown PR comments instead of as garbled "[31m...[0m" noise.
const ANSI_REGEX = /[][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-ntqry=><~]))/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, '');
}

const MAX_ERROR_LEN = 1200;

export function errorReview(agent: AgentName, message: string): Review {
  const cleaned = stripAnsi(message).trim();
  const truncated = cleaned.length > MAX_ERROR_LEN
    ? cleaned.slice(0, MAX_ERROR_LEN) + ' …(truncated; see workflow logs for full error)'
    : cleaned;
  return {
    agent,
    verdict: 'comment',
    summary: '',
    concerns: [],
    suggestions: [],
    error: truncated,
  };
}

export interface SpawnOpts {
  cmd: string;
  args: string[];
  stdin: string;
  timeoutMs?: number;
}

export function spawnCapture(opts: SpawnOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.cmd, opts.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`${opts.cmd} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      if (timeout) clearTimeout(timeout);
      reject(new Error(`spawn ${opts.cmd}: ${err.message}`));
    });
    child.on('close', code => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${opts.cmd} exited ${code}: ${stderr.slice(0, 500)}`));
    });
    child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}
