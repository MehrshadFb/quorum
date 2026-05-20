import { getOctokit, context } from '@actions/github';
import type { DiffContext } from './diff.js';

const COMMENT_MARKER = '<!-- quorum-review-comment -->';

export function octokit(): ReturnType<typeof getOctokit> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN env var not set');
  return getOctokit(token);
}

export async function getPRContext(): Promise<DiffContext & { number: number }> {
  const pr = context.payload.pull_request;
  if (!pr) throw new Error('Not running on a pull_request event');

  const kit = octokit();
  const diffRes = await kit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pr.number,
    mediaType: { format: 'diff' },
  });
  const diff = diffRes.data as unknown as string;
  const bytes = Buffer.byteLength(diff, 'utf8');

  return {
    number: pr.number,
    title: pr.title ?? '',
    description: pr.body ?? '',
    diff,
    truncated: false,
    bytes,
  };
}

export async function upsertComment(prNumber: number, body: string): Promise<void> {
  const kit = octokit();
  const { owner, repo } = context.repo;

  const existing = await kit.paginate(kit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const ours = existing.find(c => c.body?.includes(COMMENT_MARKER));
  const bodyWithMarker = `${COMMENT_MARKER}\n${body}`;

  if (ours) {
    await kit.rest.issues.updateComment({ owner, repo, comment_id: ours.id, body: bodyWithMarker });
  } else {
    await kit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: bodyWithMarker });
  }
}

export async function postReview(
  prNumber: number,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
  body: string,
): Promise<void> {
  const kit = octokit();
  const { owner, repo } = context.repo;
  await kit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event,
    body,
  });
}
