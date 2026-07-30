---
name: company-tools-react-doctor
description: Diagnose and fix this repository's React correctness, security, performance, accessibility, and architecture issues with React Doctor. Use after substantial frontend work, before a substantial frontend commit or pull request, and whenever React behavior or quality regresses.
---

# Company Tools React Doctor

Run React Doctor from `frontend/` and treat every diagnostic as evidence that
must be reviewed, not as permission for a blind rewrite.

## Required Workflow

1. Read `AGENTS.md`, `docs/FRONTEND_COMPONENTS.md`, and
   `frontend/doctor.config.json`.
2. Run:

   ```bash
   cd frontend
   npm run doctor
   ```

3. Read every diagnostic, including its file and line. Fix errors first, then
   warnings that apply to the changed code.
4. Prefer the smallest behavior-preserving fix. Do not add memoization,
   abstractions, or compatibility code only to improve a score.
5. Re-run `npm run doctor`, `npm run typecheck`, and `npm run build`.
6. Run focused Playwright coverage when user behavior changed.
7. Report the final score and any accepted residual findings.

## Commit Gate

React Doctor is mandatory before every substantial frontend commit or pull
request. A substantial change includes a new page or workflow, a component
system change, routing or provider work, broad refactoring, dependency changes,
or changes spanning several React components. Small copy-only or isolated
non-React changes do not require it.

Do not weaken `doctor.config.json` to hide a new diagnostic unless the exception
is deliberate, narrowly scoped, documented, and approved by the user.
