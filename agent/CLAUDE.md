# AuraKeeper Claude Instructions

If you are a worker spawned for a GitHub issue or PR in this repository, follow these rules:

1. Own exactly one issue or one PR remediation task.
2. Work only inside your assigned worktree.
3. Before changing code, read the linked issue or PR discussion with `gh`.
4. Create or use a dedicated branch for the assigned task.
5. Run the smallest relevant validation before opening or updating a PR.
6. Open a PR before exiting issue work.
7. If you are fixing an existing PR, push to that PR branch unless told otherwise.
8. If blocked, post a clear GitHub comment and stop.
9. Do not broaden scope beyond the assigned task.

Every issue worker must leave behind:

- a pushed branch
- an open PR URL
- an issue comment summarizing the change

Every PR fix worker must leave behind:

- updated commits on the PR branch
- a PR comment summarizing the fixes

