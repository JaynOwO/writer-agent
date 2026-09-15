# Repository instructions

## Current collaboration contract

The project owner decides product scope. ChatGPT authors the implementation and specifications.
For the v0.0.1 handoff, Spark is the local integration/test/Git executor. It should apply the supplied source files, not regenerate this project from a description.

## Boundaries

- Read this file, `docs/v0.0.1-spec.md`, and `docs/limitations.md` before changes.
- Do not redesign the architecture, broaden scope, add cloud models, add UI, or add dependencies without explicit authorization.
- A mechanical integration fix is allowed only if required to compile/run the supplied code; record every such fix and its reason. Do not silently alter patch semantics or weaken tests.
- Do not claim a tool call, test, build, Git push, or CI run succeeded unless it actually did. Include failures and blocked steps.
- This is a development preview with no selected open-source license. Do not choose a license or publish packages on the owner's behalf.

## Git safety

- Target repository: `JaynOwO/writer-agent`. Verify `origin` before any push.
- Use a feature branch, initially `feat/bootstrap-v0.0.1`. Never push directly to `main` or `master`.
- Never force-push, delete branches, reset/clean away uncommitted work, or rewrite shared history.
- Do not overwrite newly added or changed repository files merely because a delivery bundle includes the same path. The handoff importer checks collisions.
- Review the staged diff and exact changed-file list. Do not commit private writing workspaces, SQLite databases, `.env` files, credentials, runtime exports, `node_modules`, or build outputs.
- Create a PR only after local checks pass; do not merge it. If authentication or permissions prevent push/PR creation, report the exact blocker rather than attempting a workaround with pasted credentials.

## Required validation

For the first handoff only, run `pnpm install --no-frozen-lockfile` to create the real lockfile. Review and commit `pnpm-lock.yaml`. Subsequent installs and CI use `pnpm install --frozen-lockfile`.

```sh
pnpm typecheck
pnpm test
pnpm demo
```

`pnpm check` combines typechecking, building, and tests. The demo must finish with `DEMO_OK`.
The bundled author's report covers Linux/Node 22.16.0 and an offline preinstalled compiler/types environment, **not** a clean network pnpm install or Windows. Run the real install and validate the local machine; the CI matrix then exercises Node 22/24 on Linux and Windows.

## Domain invariants

1. Proposals never mutate the manuscript by themselves.
2. Only explicit accept/reject/revert actions change proposal status.
3. A text edit requires exact block ID, original text and monotonic block version.
4. Reverting one block cannot discard accepted changes to another block.
5. A changed same-block dependency causes a conflict, not fuzzy replacement.
6. Revision, document head, change status and decision are updated in one transaction.
7. Revisions and decisions are append-only; rejected proposals do not create content revisions.
8. Store a rejection reason as evidence of that decision, never automatically as a permanent preference.
9. Rule hints are warnings, not truth, calibrated confidence, source support or author intent.
10. No network calls or model API keys are required by the current runtime or test suite.
