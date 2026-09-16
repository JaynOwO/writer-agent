# Extension compatibility and authority — v0.0.8

This is a supported-subset matrix, **not conformance certification**. MCP execution uses pinned `@modelcontextprotocol/client@2.0.0`. Host `apps/cli/src/mcp-client.ts` keeps bounded transport I/O, permission identity, supported JSON Schema assertions and safe error handling. The former native lifecycle/protocol path is removed, not a fallback. Official SDK service fixtures are tested separately from owned raw-wire fixtures; neither is independent third-party service certification. See product.md/product.zh-CN.md and dependencies.md.

Old registration hashes include the previous adapter identity. Use explicit `mcp renew`/guide re-registration, then trust/discover and reselect tools; historical records are not rewritten or silently authorized. User-level presets can supply exact-endpoint credentials through host callbacks; callbacks/keys never become model values.

## MCP matrix

| Capability | Explicit implementation |
|---|---|
| Protocol selection | `2026-07-28` or `2025-11-25`, user-configured; no guessing/downgrade |
| 2026 discovery | `server/discover`, complete result, supportedVersions/capabilities and cache hints; optional serverInfo under result `_meta` |
| 2026 request metadata | namespaced protocol/clientInfo/clientCapabilities on each request; no initialize/session |
| 2025 compatibility | SDK exact-version initialize, initialized notification and session headers; close cancels the local transport (remote session expiry is service-owned) |
| stdio | absolute installed executable, argv array, explicit cwd, restricted inherited environment, no shell |
| Streamable HTTP | one POST per request, JSON or request-scoped SSE, bounded UTF-8, no redirects |
| Modern HTTP mirroring | protocol/method/name and supported `x-mcp-header` primitive property paths; Base64 sentinel when needed |
| Discovery | tools/list and resources/list; max10 pages, max100 tools and100 resources; cycles/duplicates refused |
| Tools | exact approved descriptor/schema+arguments; text outputs; optional validated object structuredContent |
| Resources | explicitly selected URI and same-URI text results; links are not opened |
| Authentication | unauthenticated endpoint or configured bearer environment variable; no OAuth |
| Additional interactions | sampling, elicitation, roots, input_required/MRTR, subscriptions, prompts and arbitrary server requests unsupported |
| Binary/media | refused; no PDF/image/blob parsing or recursive resource loading |
| Legacy SSE | no 2024 HTTP+SSE fallback, GET stream or Last-Event-ID resume |
| Retry | none automatic; timed-out/invalid post-dispatch tool outcomes conservatively remain unknown |

Remote non-OK response bodies are deliberately not exposed or interpreted into extra authentication/version behavior. A configured wrong protocol may produce a generic HTTP failure; the adapter does not silently retry another version. Discovery caching is not reused across connections; tools/resources are re-enumerated before each actual call. Relevant catalogue changes are recorded and invalidate old selected descriptors, not silently approved. This is a description/schema guard, not proof that a server cannot lie about implementation behavior.

MCP protocol sources consulted during implementation (2026-09-15 session):
- https://modelcontextprotocol.io/specification/2026-07-28/schema
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- https://modelcontextprotocol.io/docs/sdk

## Host JSON Schema policy

Only the implemented 2020-12 subset is accepted. Unknown validation keywords exclude that tool; there is no weak "looks valid" fallback. Supported assertions: boolean schemas, type, properties/required/additionalProperties, items/prefixItems, min/max items/string code-points/properties/numbers, uniqueItems, enum/const, anyOf/oneOf/allOf/not and acyclic local `#/$defs/…` references. `$schema` must be absent or 2020-12. No pattern/format/regex, remote refs, recursive schemas, conditionals, unevaluatedProperties, general vocabularies or draft07 interpretation. `$ref` does not grant schema HTTP access.

Limits: 48000 serialized schema bytes, 256 schema nodes, depth16; 64000 argument bytes, depth24/10000 validation visits. Modern `x-mcp-header` applies only to statically reachable properties of string/boolean/safe integer type. Header names are token-checked and unique case-insensitively. Invalid annotations exclude the tool. The implementation is purposely stricter than the full schema standard, not a drop-in replacement for a mature JSON Schema engine.

Connection JSON shapes (placeholders must be replaced; importing never executes):

```json
{
  "name": "Trusted installed service",
  "transport": "stdio",
  "protocol": "2025-11-25",
  "command": "C:\\Program Files\\nodejs\\node.exe",
  "args": ["C:\\trusted-tools\\server.mjs"],
  "cwd": "C:\\trusted-tools",
  "env": [],
  "timeoutMs": 20000
}
```

```json
{
  "name": "Explicit remote service",
  "transport": "http",
  "protocol": "2026-07-28",
  "url": "https://example.org/mcp",
  "tokenEnv": "MY_MCP_TOKEN",
  "allowRemote": true,
  "timeoutMs": 20000
}
```

Do not use the placeholder service as an account recommendation. Stdio inherits portable process necessities (PATH/Path, Windows system/temp fields, HOME/USERPROFILE and LANG), plus only author-approved environment names. Node injection variables and shell/installer launchers are refused. It does not block a trusted program from using its own filesystem/network access; no OS sandbox or recursive child-process confinement is provided. Shutdown closes direct-child pipes and attempts exit/TERM/KILL with bounds; grandchildren spawned by an external program are not a guaranteed isolated process tree. No unknown program was run to develop/test this release: fixtures are authored within this repository.

## Skill subset and task capture

The directory/name/SKILL.md layout follows Agent Skills, with the documented scalar YAML/text-only restrictions in the paired guide. https://agentskills.io/specification is the format source. Unsupported code/binary packages are rejected, not executed or silently treated as fully functioning skills. Free-text compatibility cannot be mechanically certified; import/enable displays it and each loaded packet keeps it alongside `support: instruction-text-only`.

Author selections, not a hidden model, choose at most three enabled skills and reference line ranges. Packet identity includes immutable package hash and the activation decision ID. Source bytes and normalized instruction body are both retained in the package; the latter is what the model actually receives. Imported files never gain filesystem/network permission. allowed-tools only restricts explicitly selected methods; supported names are a method name or `serverId/name`, not shell syntax or arbitrary capability expressions.

## Workflow integration and source provenance

Optional config.extensions contains `skills`, `calls` and `chapterDrafting`. Absent means old task behavior. Present means capture the exact skill versions, trusted connection versions, observed catalogue, descriptor/schema and fixed arguments, then incorporate them into the stage fingerprint. Selected MCP research calls currently only execute at the start of a **new-article** research phase. They do not form an arbitrary tool planner, network browser or general workflow language. Revision/audit tasks can use skills but retain original mutation semantics.

One logical MCP attempt consumes shared fetch/read quota before discovery/call; discovery RPCs have finite list limits and the same active-phase time budget. The SDK-backed host rechecks descriptor identity before dispatch and observes catalogues into local state. Unsupported post-dispatch tool content is not imported or marked success. Cache reuse only occurs for the same captured request/version/epoch. Credentials are read at use time and sent only to the explicit server, never embedded in model source context. Exact parameters may themselves contain author-supplied private text; there is no semantic secret detector.

Returned text is stored as imported bytes with a separate immutable source_provenance row (server, descriptor, attempt, raw bounded result). SourceContext gains optional `origin: {kind:'mcp',serverId,name,attemptId,descriptorHash,verification:'external-service-unverified'}`. It is not a direct-page-fetch attestation. Model context includes this origin and selected text, not connection secret fields. The source/context read verifies both hash and origin; removing the origin invalidates the packet.

## Derived index, citation and chapter bounds

Index keys include saved snapshot/content hash and `paragraph-window-v1`. Every chunk has exact unmodified source offsets/lines/hash and adjacent chunk IDs. Navigation heading labels are capped. Latin literal terms/Han bigrams rank windows; neighboring context is included within the byte cap. A no-match passage is marked navigation only. Ranking has no source-truth meaning. Dates/source roles remain unclassified when unknown; retrieval does not certify primary-source status or real-world freshness.

Enhanced draft validation permits at most100 selected quote records and512 source markers, with at most2000 map bindings and bounded serialized payload. Legacy requests keep their original quotation-validation path. Each source-entry quote may be associated with multiple matching markers: this is explicitly `source-entry-candidates-not-claim-support`, not independently proven sentence entailment. The neighboring-text range is a simple punctuation/newline heuristic. Offsets are UTF-16; surrogate-split quotations are rejected. The map pins selected-text line range and source identity; those offsets are not original HTML locations.

Chapter requests add `section:{index,total,heading,approvedOutlineHash}` and retain the approved global outline/author guidance. Chapter evidence comes from the already-frozen research packet, not another silent full-source scan or web request. Required cited items precede optional literal-relevance selections. Host composition remaps local evidence indices and creates a host artifact under the lease/checkpoint transaction. One full-candidate critique and at most one optional revision follow. Missing/colliding sources and oversize whole-candidate review stop the run. This first version does not guarantee thematic/term consistency or unlimited-length writing.

## Schema6 and historical decoding

Additive tables: skill_packages/skill_decisions, mcp_servers/mcp_trust/mcp_catalogs, source_provenance, research_indexes, citation_maps. Original tables/IDs are preserved. Source kind remains web/file at the original schema boundary; provenance distinguishes imported MCP text. Derived indexes can be rebuilt; original text, approvals and citation provenance cannot be discarded. Citation maps/artifacts/activation decisions have append-only triggers and integrity hashes, not adversarial tamper-proofing against the file owner.

Explicit backed-up migration accepts schemas1–5 and refuses unknown formats. Code installation never migrates writing data. Old requests without extension fields preserve their original hashes and are not retroactively asserted to have read skills or index-selected material. After a manuscript edit, citation maps become historical/stale; candidate maps remain tied to their artifact. An author adoption and its exact citation map/checkpoint commit together.

## v0.0.8 SDK integration notes

The SDK provides Client, protocol version selection/validation and StreamableHTTPClientTransport. A custom bounded stdio **Transport** frames SDK messages; it does not implement an alternate initialize/discover protocol. Guarded fetch restricts endpoint/method, refuses redirects, bounds UTF-8/JSON/SSE responses and disables unsolicited GET streams/reconnect/step-up callbacks. Additional SDK capabilities are not author permission. Plaintext/unknown key fallback is not enabled. Never interpret a successful connection as proof of account balance or safe server behavior.

Metadata resolution in `product doctor` does not import/unlock the OS backend or launch SDK servers. Explicit tests pin version/input/caps and are recorded separately. Direct-child cleanup is bounded; there is no process-tree OS sandbox. Refer to the release validation report for actual OS and SDK fixture results.
