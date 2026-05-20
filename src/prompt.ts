export const REVIEW_PROMPT_TEMPLATE = `You are a code reviewer in the Quorum multi-AI consensus review system.
Other AI agents are reviewing this same pull request independently. You will not see their reviews and they will not see yours. Your job is to provide an honest, specific, structured review — do not rubber-stamp, and do not invent concerns to seem useful.

Return ONLY a single JSON object matching the schema below. No prose, no markdown fences, no preamble. If you cannot return valid JSON, the review will be rejected.

Schema:
{
  "verdict": "approve" | "request_changes" | "comment",
  "summary": "1-2 sentences: what the PR does and your overall take",
  "concerns": [
    {
      "severity": "blocker" | "major" | "minor",
      "file": "path/from/repo/root.ts",
      "line": 42,
      "message": "specific, actionable description (max 240 chars)"
    }
  ],
  "suggestions": [
    {
      "file": "path/from/repo/root.ts",
      "line": 42,
      "current": "code being replaced (verbatim from diff)",
      "proposed": "code you propose",
      "rationale": "why"
    }
  ]
}

Verdict rules:
- "approve": no blockers and no majors.
- "request_changes": one or more blockers or majors.
- "comment": purely advisory feedback on a PR you would otherwise approve.

PR title: {{title}}

PR description:
{{description}}

Diff:
{{diff}}
`;

export interface PromptInput {
  title: string;
  description: string;
  diff: string;
}

export function renderPrompt(input: PromptInput, template: string = REVIEW_PROMPT_TEMPLATE): string {
  return template
    .replace('{{title}}', input.title || '(no title)')
    .replace('{{description}}', input.description || '(no description)')
    .replace('{{diff}}', input.diff);
}

export const DEBATE_PROMPT_TEMPLATE = `You are participating in round {{round}} of the Quorum multi-AI consensus review.

In the previous round, you and other agents reviewed this PR independently. Now you can see their reviews. Your job: update your verdict if their arguments are factually stronger than yours, OR stand by your original take and explain why their concerns don't hold.

DO NOT cave just because others disagreed. LLMs default to agreeableness; that's bad signal. Only update if their reasoning is *specifically* better than yours, citing the diff. If you stand firm, you must briefly explain why.

Return the same JSON schema as round 1:
{
  "verdict": "approve" | "request_changes" | "comment",
  "summary": "your updated take (or restated take if you didn't move)",
  "concerns": [{ "severity": "blocker"|"major"|"minor", "file": "...", "line": 42, "message": "..." }],
  "suggestions": [{ "file": "...", "line": 42, "current": "...", "proposed": "...", "rationale": "..." }],
  "changed_from_previous": true | false,
  "reasoning": "1-2 sentences: why you updated (or didn't)"
}

Other agents' reviews from round {{previous_round}}:
{{other_reviews}}

Your previous review:
{{own_previous_review}}

PR title: {{title}}

PR description:
{{description}}

Diff:
{{diff}}
`;

export interface DebatePromptInput extends PromptInput {
  round: number;
  previousRound: number;
  otherReviews: string;
  ownPreviousReview: string;
}

export function renderDebatePrompt(input: DebatePromptInput): string {
  return DEBATE_PROMPT_TEMPLATE
    .replace('{{round}}', String(input.round))
    .replace('{{previous_round}}', String(input.previousRound))
    .replace('{{title}}', input.title || '(no title)')
    .replace('{{description}}', input.description || '(no description)')
    .replace('{{diff}}', input.diff)
    .replace('{{other_reviews}}', input.otherReviews)
    .replace('{{own_previous_review}}', input.ownPreviousReview);
}

export const IMPLEMENTER_PROMPT_TEMPLATE = `You are the implementer agent in the Quorum collaboration mode.

Other AI reviewers raised the concerns below on this PR. Your job: edit the files in this workspace to address ALL listed blockers and majors, without breaking the PR's stated intent or causing test failures.

You have read/edit/write access to the project files. Make minimal, surgical changes that resolve the concerns. Do NOT:
- Change files unrelated to the concerns
- Reformat or restyle code beyond the fix
- Add new dependencies unless absolutely necessary
- Touch tests except to add coverage for the fix

When you're done, exit. Your changes will be committed by Quorum and the PR will be re-reviewed.

PR title: {{title}}

PR description:
{{description}}

Blockers and majors from the other agents (you MUST address all of these):
{{concerns}}

Original diff (what the PR changed):
{{diff}}
`;

export interface ImplementerPromptInput {
  title: string;
  description: string;
  concerns: string;
  diff: string;
}

export function renderImplementerPrompt(input: ImplementerPromptInput): string {
  return IMPLEMENTER_PROMPT_TEMPLATE
    .replace('{{title}}', input.title || '(no title)')
    .replace('{{description}}', input.description || '(no description)')
    .replace('{{diff}}', input.diff)
    .replace('{{concerns}}', input.concerns);
}
