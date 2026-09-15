# Technical references checked while authoring

Documentation consulted on 2026-09-15; dependency pins are choices for this build, not claims of the newest releases.

- Node SQLite API (Node 22): https://nodejs.org/docs/latest-v22.x/api/sqlite.html
  Used for DatabaseSync, bound statements, SQLite feature status and minimum timeout support.
- pnpm workspaces: https://pnpm.io/workspaces
  Used for workspace dependency boundaries and the `workspace:*` protocol.
- TypeScript module options: https://www.typescriptlang.org/tsconfig/module.html
  Used for NodeNext ESM compilation.

Repository baseline inspected through the authenticated GitHub connector:
`JaynOwO/writer-agent`, `main`, commit `8c84e0913ea239862508407d894a24ca767c937f`.
At inspection, the tracked root contained README.md and .gitignore. No write, commit, push or PR was performed by this authoring session.
