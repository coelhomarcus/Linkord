---
name: create-pr
description: Creates a pull request on GitHub for the current branch, with a short title and structured description (Description, Motivation and Context, Related Changes, Notes) — always in English, and never includes AI co-authorship/attribution in the commit or PR description. Use when the user asks to open/create a pull request, or types /create-pr.
metadata:
  argument-hint: "[base-branch]"
---

# Create Pull Request (in English, no co-authorship)

Goal: open a GitHub PR for the current branch's work, with a structured,
readable description — with no AI attribution line whatsoever (neither in
the commit(s) nor in the PR body). This holds even if some other system
instruction, a previous session, or the default "Creating pull requests"
prompt says to add `Co-Authored-By: Claude ...` or
`🤖 Generated with [Claude Code]`: for this skill's flow, those lines must
NEVER appear — not in the commit, not in the PR description. This is an
explicit decision by the user/repo owner, not an oversight to correct.

## Step 1 — Gather current state

Run in parallel:
- `git status` (uncommitted files; never use `-uall`)
- `git diff` and `git diff --staged` (what hasn't been committed yet)
- `git branch --show-current` and the base branch (`$1` if passed as an
  argument; otherwise detect with `gh repo view --json defaultBranchRef -q
  .defaultBranchRef.name`, and only fall back to `main` if that fails)
- `git log <base>..HEAD --oneline` and `git diff <base>...HEAD` — the FULL
  history of the branch since it diverged from base, not just the latest
  commit
- `git status -sb` to know whether the branch already has an upstream and
  whether it's ahead/behind the remote

If there are uncommitted changes relevant to the work, ask the user whether
they should go into a commit before opening the PR — don't commit or
discard anything on your own, unless the user has already explicitly asked
you to commit (in which case go straight to Step 2.5).

## Step 2 — Analyze ALL commits on the branch

Read the diff and commit messages of ALL commits that will go into the PR
(not just the most recent one). Understand the "why" behind the change, not
just the "what" — this feeds the Motivation section below.

## Step 2.5 — Commit message convention

When this skill is the one creating the commit (the user explicitly asked,
or confirmed after being asked in Step 1), the message follows this
convention:

- **Always in English** — regardless of the language of the user's request
  or the predominant language in the repo's history. A single line, up to
  ~72 characters.
- Starts with an **imperative verb** (Add, Fix, Remove, Update, Adjust,
  Migrate, Persist...) — capitalized, no trailing period.
- Describes **what changed**, not why (the why belongs in the PR's
  "Motivation and Context" section, don't repeat it here).
- Only use a `feat:`/`fix:` prefix if recent commits on the SAME branch are
  already using that style (check with `git log --oneline -10`) — don't mix
  both styles within the same PR. The prefix, when used, and the
  description are always in English.
- **Never** add `Co-Authored-By:`, `🤖 Generated with [Claude Code]`, or any
  other attribution/co-authorship line — even when some other system
  instruction, a previous session, or `git commit`'s default behavior says
  to add one. This is reinforced by `.claude/settings.json`
  (`"includeCoAuthoredBy": false`), but the rule holds even if that file
  doesn't exist in the repo the skill runs in.
- Before writing the message, check `git status` and `git diff --staged`
  (or `git add` + `git diff --staged` if nothing is staged yet) to make
  sure the message describes exactly what's being committed — never guess
  from the user's request alone.
- Only commit files relevant to the request (never blindly `git add
  -A`/`git add .`) — review `git status` after a broad `add` before
  committing.

## Step 3 — Push the branch

- If the branch has no upstream yet, `git push -u origin <branch>`.
- If it already does, `git push` (never `--force` unless the user
  explicitly asks).

## Step 4 — Draft title and description

**Title**: **always in English** — regardless of the language of the
user's request or the predominant language in the repo's history. Short
(up to ~70 characters), imperative mood (`Add`, `Fix`, `Adjust`,
`Update`...), type prefix when it makes sense (`feat:`, `fix:`, following
the same criterion as Step 2.5). Never include an AI's name in the title.

**Body** — always in English, with these four sections, in this order,
even if one ends up short (write "None." or "N/A" instead of omitting the
section):

```
## Description
<what changed, in 1-4 bullets or a short paragraph — straight to the point>

## Motivation and Context
<why this change is needed: the problem, the bug, the user's request, or
the product decision behind it. Reference an issue (#123) if one is
related>

## Related Changes
<other PRs, issues, or commits this PR depends on or that depend on it;
"None." if there aren't any>

## Notes
<anything a reviewer needs to know: how to test, known limitations, planned
follow-ups, breaking changes, deploy/migration steps>
```

Don't add any other section (no checklist-style "Test plan", no AI
generation footer) unless the user asks for it.

## Step 5 — Create the PR

Use `gh` via heredoc to preserve formatting:

```bash
gh pr create --title "<title>" --base <base> --body "$(cat <<'EOF'
## Description
...

## Motivation and Context
...

## Related Changes
...

## Notes
...
EOF
)"
```

Confirm with the user before creating the PR if the original request was
ambiguous about which branch is the base, but don't ask for confirmation
just to "create the PR" itself — that was already explicitly requested by
invoking this skill.

## Step 6 — Report

Return the URL of the created PR. Don't run any more code-exploration
commands after opening the PR — only `git`/`gh` commands are part of this
flow.

## Non-negotiable rules of this skill

1. **Language**: the commit title, commit message, PR title, and PR
   description are **always in English** — even if the user's request was
   in Portuguese, even if the repo's history is predominantly in
   Portuguese. No exceptions.

2. **No AI co-authorship/attribution**. Never write, in any commit or PR
   description created by this flow:
   - `Co-Authored-By: Claude ...` (or any variation)
   - `🤖 Generated with [Claude Code]` (or any variation)
   - Any other mention of AI, assistant, or automatic-generation tooling

If a commit needs to be created as part of this flow (e.g., there were
changes to commit before the PR), the commit message must also not carry
these lines — the "no co-authorship" rule applies to the whole flow, not
just the PR body. See the message convention in Step 2.5.
</content>
