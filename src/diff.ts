import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface DiffContext {
  title: string;
  description: string;
  diff: string;
  truncated: boolean;
  bytes: number;
}

export async function localDiff(baseRef = 'main'): Promise<DiffContext> {
  const { stdout: title } = await exec('git', ['log', '-1', '--pretty=%s']);
  const { stdout: body } = await exec('git', ['log', '-1', '--pretty=%b']);
  let diff = '';
  try {
    const result = await exec('git', ['diff', `${baseRef}...HEAD`], { maxBuffer: 50 * 1024 * 1024 });
    diff = result.stdout;
  } catch {
    const result = await exec('git', ['diff', 'HEAD'], { maxBuffer: 50 * 1024 * 1024 });
    diff = result.stdout;
  }
  const bytes = Buffer.byteLength(diff, 'utf8');
  return {
    title: title.trim(),
    description: body.trim(),
    diff,
    truncated: false,
    bytes,
  };
}

export function truncateDiff(ctx: DiffContext, maxBytes: number): DiffContext {
  if (ctx.bytes <= maxBytes) return ctx;
  const truncated = ctx.diff.slice(0, maxBytes);
  return {
    ...ctx,
    diff: truncated + `\n\n... (diff truncated: ${ctx.bytes - maxBytes} bytes omitted, ${Math.round((ctx.bytes - maxBytes) / 1024)}KB)`,
    truncated: true,
  };
}
