# quorum

Multi-AI consensus review for pull requests. **No merges to `main` without the AI panel agreeing.**

```
                ┌────────────┐
   PR opened ──▶│  Claude    │──┐
                ├────────────┤   ├──▶ consensus ──▶ ✅ approve / 🛑 block
                │  Codex     │──┤
                ├────────────┤   │
                │  Gemini    │──┘
                └────────────┘
```

Each AI reviews the PR independently. They never see each other's reviews. Quorum aggregates their verdicts, posts a single comment, and submits a formal GitHub review. Pair with branch protection on `main` and you can't merge until the panel agrees.

---

## Quick start

```bash
cd your-repo
npx quorum@latest setup
```

(or `npm i -g quorum` if you want it permanently installed)

That's it. The wizard:
1. Checks your environment (Node 20+, `git`, `gh`).
2. Asks which AIs you want on the panel (minimum 2, recommended 3).
3. Picks a consensus mode (strict — all must agree, or majority — >50%).
4. Writes `quorum.config.yml` and `.github/workflows/quorum.yml`.
5. Walks you through adding API keys for Claude, Codex, Gemini, and Grok.
6. Pushes each API key to your repo as a GitHub secret via `gh secret set`.
7. Tells you how to protect `main` so the check actually blocks merges.

Open a PR. Quorum comments within ~30s.

---

## Commands

| Command | What it does |
| --- | --- |
| `quorum` *(no args)* | Same as `quorum setup` — guided onboarding |
| `quorum setup` | One-shot guided install + auth (idempotent — safe to re-run) |
| `quorum init` | Just copy the workflow + config files |
| `quorum auth [--agent <name>] [--no-push]` | Set up provider API keys, push as repo secrets |
| `quorum review [-b main]` | Run the panel locally against your current branch |
| `quorum doctor` | Diagnose missing prerequisites or broken config |
| `quorum status` | Show current config + which secrets/files are in place |

Pass `--help` to any of them for flags.

---

## Three modes — how agents reach a verdict

| Mode | What happens | When to use |
| --- | --- | --- |
| **`silent`** (default) | Blind parallel reviews. Each agent reviews independently, never sees the others. Dissent is surfaced verbatim — you break ties. | Honest disagreement signal. Recommended for most repos. |
| **`debate`** | Round 1 blind, round 2 each agent sees the others' reviews and may update its verdict (with required justification). No code changes. | When you want faster convergence and accept the agreeableness risk. |
| **`collaborate`** | Debate + one designated agent commits fixes to the PR branch. Push re-triggers the action. Loop until consensus or `max_rounds`. | When you want PRs to be ready-to-merge by the time you look. Needs `QUORUM_BOT_TOKEN` with push access. |

**The agreeableness trap**: LLMs in multi-turn discussion default to consensus-seeking. The `debate` and `collaborate` prompts include explicit "stand by your original take unless their arguments are factually stronger" instructions, but the bias is real. If you care about honest disagreement signal, stick with `silent`.

The setup wizard asks you to pick one. Change anytime in `quorum.config.yml`.

## How consensus works

Each agent returns a structured verdict:

```json
{ "verdict": "approve" | "request_changes" | "comment",
  "summary": "...",
  "concerns": [{ "severity": "blocker" | "major" | "minor", "file": "...", "line": 42, "message": "..." }],
  "suggestions": [{ "file": "...", "line": 42, "current": "...", "proposed": "...", "rationale": "..." }] }
```

The aggregator (`src/consensus.ts`) then decides:

- **`mode: strict`** — every required agent must verdict `"approve"`. Anyone dissenting → block.
- **`mode: majority`** — >50% of required agents must approve. Requires ≥3 agents (the validator rejects fewer — otherwise there's no tiebreaker).

Disagreements are **surfaced**, not papered over. The PR comment lists each agent's verdict and reasoning so you can override the panel when they're wrong.

---

## API Keys

Each provider is run through its CLI, but CI authentication is API-key based:

| Agent | Auth method | Falls back to |
| --- | --- | --- |
| Claude | `ANTHROPIC_API_KEY` | n/a |
| Codex | `OPENAI_API_KEY` | n/a |
| Gemini | `GEMINI_API_KEY` | `GOOGLE_API_KEY` locally |
| Grok | `XAI_API_KEY` | `GROK_API_KEY` locally |

`quorum auth` reads API keys from your local environment when present, or prompts for them, then pushes them to repo secrets.

---

## Configuration

Everything lives in `quorum.config.yml`. The full schema (with defaults) is in [`template/quorum.config.yml`](template/quorum.config.yml). Highlights:

```yaml
agents:
  required: [claude, codex, gemini]      # min 2, all must approve in strict mode
  advisory: [grok]                       # comments only, doesn't block
  options:
    grok:
      model: grok-4-latest

mode: strict                             # or: majority

github:
  post_comments: true
  request_changes: true
  fail_check: true                       # set false for advisory-only mode
  skip_label: skip-quorum                # PRs with this label bypass quorum
  only_label: null                       # if set, only review PRs with this label

review:
  max_diff_bytes: 200000
  skip_paths:                            # all files in PR match → skip review
    - "*.md"
    - "docs/**"
  custom_prompt_path: null               # path to a custom prompt template file
```

---

## Branch protection (the missing piece)

Quorum is only as strict as your branch protection rule. Set this once in your repo:

**Settings → Branches → Add rule for `main`:**
- ✅ Require a pull request before merging
- ✅ Require status checks to pass — add **`Quorum`**
- ✅ Block direct pushes

Now `git push origin main` is rejected and `merge` is rejected when Quorum blocks. `quorum doctor` will warn you when this rule isn't in place.

---

## Local dry run

Before opening a PR, run the panel locally:

```bash
quorum review -b main
```

Uses the same prompt and same agents the CI workflow would. Reads API keys from your local env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`).

---

## Project layout

```
quorum/
├── action.yml                  GitHub Action manifest
├── src/
│   ├── action.ts               action entry (runs in CI)
│   ├── cli.ts                  CLI dispatcher
│   ├── cli/
│   │   ├── setup.ts            guided onboarding (default `quorum` command)
│   │   ├── init.ts             non-interactive file copy
│   │   ├── auth.ts             provider auth + push to repo secrets
│   │   ├── review.ts           local dry-run
│   │   ├── doctor.ts           diagnostic
│   │   └── status.ts           inspect repo state
│   ├── agents/                 one runner per provider
│   ├── consensus.ts            verdict aggregation
│   ├── config.ts               yaml schema + validation
│   ├── checks.ts               shared diagnostic helpers
│   ├── prompt.ts               structured-review prompt template
│   ├── diff.ts                 git/PR diff fetching
│   └── github.ts               PR comment + review submission
└── template/
    ├── .github/workflows/quorum.yml
    └── quorum.config.yml
```

---

## Limitations & honesty

- **Agent CLI invocation is best-effort.** Non-interactive flags for the provider CLIs (`claude -p`, `codex exec`, `gemini --prompt`) shift between releases. If a runner starts erroring, check the CLI's `--help` and update `src/agents/<provider>.ts`.
- **LLMs default to agreeable.** Two agents agreeing is often one mirroring the other's framing. Three independent agents disagreeing is real signal. Recommended floor: 3.
- **API keys are required in CI.** Session/keychain auth is intentionally not used by Quorum.
- **`request_changes` on your own PR** doesn't work via the default `GITHUB_TOKEN` — Quorum still posts the comment and fails the check, but the formal review event will be a "comment" instead. Use a fine-scoped PAT in `secrets.QUORUM_REVIEW_TOKEN` if you want formal `REQUEST_CHANGES` on self-authored PRs.

---

## License

MIT.
