# Worker Agent

The Worker Agent turns a Replicator Agent handoff into the smallest safe code
fix.

## Goal

Given a reproduction report from the Replicator Agent, identify the root cause
and produce a minimal patch that fixes the observed failure with the least
amount of LOC changed.

## Inputs

- Replicator Agent handoff file
- TLDR, likely cause, reproduction steps, commands, and logs from the handoff
- structured error event or grouped issue summary when the orchestrator includes
  it
- repository checkout at the affected version
- project instructions and allowed file paths
- verification commands when configured

## Responsibilities

1. Wait for the Replicator Agent handoff before changing code.
2. Confirm the reported failing code path and root cause.
3. Change only the files and lines needed to fix that root cause.
4. Run the most relevant verification command available.
5. Return the patch, root cause, commands run, and any remaining risk.

## Constraints

- Prefer a targeted fix over a broad refactor.
- Treat the Replicator Agent handoff as the primary diagnosis input.
- Do not rename, reformat, or clean up unrelated code.
- Do not change public contracts unless the error proves the contract is wrong.
- Do not edit unrelated files to satisfy style preferences.
- If no safe minimal fix is available, report why instead of guessing.
- The `patch` field may be either a Codex `*** Begin Patch` block or a unified
  diff that `git apply` can consume.
- Prefer the Codex `*** Begin Patch` format when possible because AuraKeeper
  canonicalizes it before verification.
- Do not include prose in the `patch` field.

## Output

The Worker Agent should return:

- status: `patched`, `blocked`, or `needs_context`
- issue summary
- suspected root cause
- files changed
- LOC changed
- patch
- verification commands and results
- confidence and remaining risk
