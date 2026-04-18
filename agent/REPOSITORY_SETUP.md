# Repository Setup And Upstream Changes

This repository is often copied as a plain working tree without `.git`. When that happens, initialize Git and point the copy at the correct GitHub repository before starting the orchestrator.

## Fresh copy without `.git`

From inside the copied directory:

```bash
git init
git checkout -b main
git remote add origin git@github.com:<owner>/<repo>.git
git add .
git commit -m "Import AuraKeeper agent"
git push -u origin main
```

After the first push, bootstrap GitHub metadata:

```bash
./bin/aurakeeper bootstrap-github
```

## Change the upstream repository

If the GitHub repository was renamed or moved, update `origin`:

```bash
git remote set-url origin git@github.com:<owner>/<repo>.git
git remote set-url --push origin git@github.com:<owner>/<repo>.git
```

Verify the change:

```bash
git remote -v
gh repo view --json name,owner,url
```

## Repoint an existing local branch to the new upstream

If `main` already exists and you want to ensure tracking is correct:

```bash
git branch --set-upstream-to=origin/main main
git fetch origin
git status -sb
```

## Rename the local directory only

If you only rename the folder on disk, Git does not need any remote changes. Only update commands, scripts, or documentation that contain the old path.

## Daily sync commands

Pull the latest default branch:

```bash
git pull --rebase origin main
```

Push local changes:

```bash
git push origin main
```

## Useful checks

Confirm the repo GitHub target:

```bash
gh repo view --json defaultBranchRef,name,owner,url
```

Confirm the orchestrator sees the same repository:

```bash
./bin/aurakeeper status
```

