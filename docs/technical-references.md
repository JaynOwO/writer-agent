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


## v0.0.2 references (consulted 2026-09-15)

- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0.txt
- OpenAI Chat Completions reference: https://platform.openai.com/docs/api-reference/chat/create
- OpenAI Structured Outputs: https://platform.openai.com/docs/guides/structured-outputs
- Ollama native chat: https://docs.ollama.com/api/chat
- Ollama structured outputs: https://docs.ollama.com/capabilities/structured-outputs

These document the formats this implementation targets, not evidence of having called a live model. The native Ollama adapter uses non-streaming format/schema and num_predict; the compatible adapter uses Chat Completions and explicit response-format/token options. The Apache text includes its appendix; NOTICE provides project attribution separately. No upstream API sample implementation was copied into runtime code.
