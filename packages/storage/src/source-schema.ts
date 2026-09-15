// SPDX-License-Identifier: Apache-2.0
/** Additive schema v2: no existing document, revision, change or decision table is rewritten. */
export const SOURCES_SQL = `
CREATE TABLE sources (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('web','file')),
  locator TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX sources_web_url ON sources(locator) WHERE kind='web';
CREATE TABLE source_snapshots (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  captured_at TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('text/html','text/plain','text/markdown')),
  raw BLOB NOT NULL CHECK(length(raw) <= 2000000),
  raw_hash TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  extractor TEXT NOT NULL,
  warnings_json TEXT NOT NULL CHECK(json_valid(warnings_json))
) STRICT;
CREATE INDEX snapshots_source ON source_snapshots(source_id, seq);
CREATE TABLE source_excerpts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  start_line INTEGER NOT NULL CHECK(start_line>0),
  end_line INTEGER NOT NULL CHECK(end_line>=start_line),
  start_offset INTEGER NOT NULL CHECK(start_offset>=0),
  end_offset INTEGER NOT NULL CHECK(end_offset>=start_offset),
  quote TEXT NOT NULL,
  quote_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX excerpts_snapshot ON source_excerpts(snapshot_id,seq);
CREATE TABLE research_notes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  excerpt_id TEXT REFERENCES source_excerpts(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE source_bindings (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  block_id TEXT NOT NULL,
  block_version INTEGER NOT NULL CHECK(block_version>0),
  excerpt_id TEXT NOT NULL REFERENCES source_excerpts(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX bindings_document ON source_bindings(document_id,seq);
CREATE TABLE proposal_contexts (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  base_revision_id TEXT NOT NULL REFERENCES revisions(id),
  provider_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  items_json TEXT NOT NULL CHECK(json_valid(items_json)),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE change_contexts (
  change_id TEXT PRIMARY KEY NOT NULL REFERENCES changes(id),
  context_id TEXT NOT NULL REFERENCES proposal_contexts(id)
) STRICT;
` + ['sources','source_snapshots','source_excerpts','research_notes','source_bindings','proposal_contexts','change_contexts'].map(table => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN
  SELECT RAISE(ABORT, 'source records are append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN
  SELECT RAISE(ABORT, 'source records are append-only'); END;
`).join('');
