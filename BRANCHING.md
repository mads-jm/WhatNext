# BRANCHING.md

    ## Branch Hierarchy

    main          ← stable releases only
      └── mvp     ← current staging/working branch (merge target for all feature work)
            └── feat/*   ← feature branches
            └── fix/*    ← bug fix branches

    ## Rules for Agents

    **Before starting any work, you MUST:**

    1. Run `git branch --show-current` to confirm the active branch
    2. Run `git log --oneline -5` to identify the latest staging branch
    3. **Never branch from `main`** — `main` is behind the working branch and will be missing current infrastructure

    **When creating a worktree or feature branch:**

    ```bash
    # CORRECT — branch from current staging
    git worktree add <path> -b <branch> mvp

    # WRONG — do not do this
    git worktree add <path> -b <branch> main
    git worktree add <path> -b <branch> origin/main

    Current staging branch: mvp
    ▎ Update this line when the staging branch changes.

    Why This Matters

    Branching from main instead of the staging branch means the worktree is missing all in-progress work (schemas, components, IPC handlers, etc.). Code written against the wrong base will not compile and cannot be merged without
    significant rework.
