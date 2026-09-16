import { EXTENSION_SQL } from './extension-schema.js';
// SPDX-License-Identifier: Apache-2.0
import { SOURCES_SQL } from './source-schema.js';
import { WORKFLOW_SQL } from './workflow-schema.js';
import { MEMORY_SQL } from './memory-schema.js';
import { ANALYSIS_SQL } from './analysis-schema.js';
export const SCHEMA_VERSION = 6;
export const APPLICATION_ID = 0x57525431; // "WRT1"
export const SCHEMA_V1_SQL = `
CREATE TABLE workspace (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  head_revision_id TEXT REFERENCES revisions(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE revisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  parent_id TEXT REFERENCES revisions(id),
  kind TEXT NOT NULL CHECK (kind IN ('created','accepted','reverted')),
  change_id TEXT,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX revisions_document ON revisions(document_id, seq);
CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id),
  base_revision_id TEXT NOT NULL REFERENCES revisions(id),
  block_id TEXT NOT NULL,
  base_block_version INTEGER NOT NULL CHECK (base_block_version > 0),
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  summary TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  hints_json TEXT NOT NULL CHECK (json_valid(hints_json)),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','reverted')),
  accepted_revision_id TEXT REFERENCES revisions(id),
  accepted_block_version INTEGER,
  created_at TEXT NOT NULL,
  CHECK (before_text != after_text),
  CHECK (
    (status IN ('pending','rejected') AND accepted_revision_id IS NULL AND accepted_block_version IS NULL)
    OR
    (status IN ('accepted','reverted') AND accepted_revision_id IS NOT NULL AND accepted_block_version > 0)
  )
) STRICT;
CREATE INDEX changes_document ON changes(document_id, seq);
CREATE TABLE decisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  change_id TEXT NOT NULL REFERENCES changes(id),
  action TEXT NOT NULL CHECK (action IN ('accepted','rejected','reverted')),
  reason TEXT NOT NULL,
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX decisions_change ON decisions(change_id, seq);
CREATE TRIGGER revisions_no_update BEFORE UPDATE ON revisions BEGIN
  SELECT RAISE(ABORT, 'revisions are append-only'); END;
CREATE TRIGGER revisions_no_delete BEFORE DELETE ON revisions BEGIN
  SELECT RAISE(ABORT, 'revisions are append-only'); END;
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions BEGIN
  SELECT RAISE(ABORT, 'decisions are append-only'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions BEGIN
  SELECT RAISE(ABORT, 'decisions are append-only'); END;
PRAGMA application_id = ${APPLICATION_ID};
PRAGMA user_version = 1;
`;

export const SCHEMA_SQL = SCHEMA_V1_SQL + SOURCES_SQL + ANALYSIS_SQL + MEMORY_SQL + WORKFLOW_SQL + EXTENSION_SQL + `PRAGMA user_version = ${SCHEMA_VERSION};`;
