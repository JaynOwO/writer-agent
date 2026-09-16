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

## v0.0.3 source/migration references (consulted 2026-09-15)

- [Node.js 22.16 SQLite API](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html): synchronous storage and supported runtime baseline.
- [SQLite VACUUM / VACUUM INTO](https://www.sqlite.org/lang_vacuum.html): consistent backup before an additive schema change.
- [SQLite backup overview](https://www.sqlite.org/backup.html): why a live WAL database should not be backed up by copying only its main file.
- [Node.js HTTP API](https://nodejs.org/download/release/v22.16.0/docs/api/http.html) and [HTTPS API](https://nodejs.org/api/https.html): lookup, request controls, complete responses and TLS.
- [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): address validation, DNS rebinding/pinning, redirect restrictions and defense in depth.

The application implements a conservative prototype policy and fixture tests, not all recommendations or a formal security certification. The small HTML tokenizer is original implementation code, explicitly not a standards-complete parser.

## v0.0.4 implementation references

- Node SQLite API: https://nodejs.org/docs/latest-v22.x/api/sqlite.html
- SQLite VACUUM INTO consistency/backup: https://www.sqlite.org/lang_vacuum.html
- OpenAI Structured Outputs: https://platform.openai.com/docs/guides/structured-outputs
- Ollama native structured output: https://docs.ollama.com/capabilities/structured-outputs

Reference review date: 2026-09-15 (retrieval limitations below). Runtime interoperability is independently limited to the actual tested fixtures/environments. Schema support does not validate semantic correctness.

The v0.0.4 authoring session retrieved the SQLite VACUUM, OpenAI structured-output and Ollama structured-output pages. The versioned Node documentation page could not be retrieved in that session; Node behavior was checked against the installed v22.16.0 runtime and existing regression tests instead. Links are not proof of live provider compatibility.

## v0.0.5 implementation references

- Node readline/promises and question cancellation: https://nodejs.org/api/readline.html
- Node AbortController/AbortSignal: https://nodejs.org/api/globals.html
- SQLite transactional backup primitive already used by this project: https://sqlite.org/lang_vacuum.html

No new dependency or API version is selected from a claim that it is latest. Validation uses the installed Node22.16.0 runtime and exact existing compiler/types. Documentation retrieval does not substitute for runtime tests or Windows/real-provider validation; some versioned Node URLs were not retrievable during this session.
