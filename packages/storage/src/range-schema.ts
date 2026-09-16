// SPDX-License-Identifier: Apache-2.0
export const RANGE_SQL = `
CREATE TABLE range_sets (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id),
 base_revision_id TEXT NOT NULL REFERENCES revisions(id), source_change_id TEXT UNIQUE REFERENCES changes(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL
) STRICT;
CREATE TABLE range_operations (
 seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, set_id TEXT NOT NULL REFERENCES range_sets(id),
 document_id TEXT NOT NULL REFERENCES documents(id), status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','reverted')),
 payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL
) STRICT;
CREATE INDEX range_operations_document ON range_operations(document_id,seq);
CREATE TABLE range_decisions (
 seq INTEGER PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES range_operations(id),
 document_id TEXT NOT NULL REFERENCES documents(id), revision_id TEXT NOT NULL REFERENCES revisions(id),
 action TEXT NOT NULL CHECK(action IN ('accepted','rejected','reverted')), reason TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE content_journals (
 revision_id TEXT PRIMARY KEY REFERENCES revisions(id), document_id TEXT NOT NULL REFERENCES documents(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL
) STRICT;
CREATE TABLE editing_buffers (
 id TEXT PRIMARY KEY, document_id TEXT UNIQUE NOT NULL REFERENCES documents(id), base_revision_id TEXT NOT NULL REFERENCES revisions(id),
 version INTEGER NOT NULL CHECK(version>0), payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER range_sets_no_update BEFORE UPDATE ON range_sets BEGIN SELECT RAISE(ABORT,'range sets are immutable'); END;
CREATE TRIGGER range_sets_no_delete BEFORE DELETE ON range_sets BEGIN SELECT RAISE(ABORT,'range sets are immutable'); END;
CREATE TRIGGER content_journals_no_update BEFORE UPDATE ON content_journals BEGIN SELECT RAISE(ABORT,'content journals are append-only'); END;
CREATE TRIGGER content_journals_no_delete BEFORE DELETE ON content_journals BEGIN SELECT RAISE(ABORT,'content journals are append-only'); END;
CREATE TRIGGER range_decisions_no_update BEFORE UPDATE ON range_decisions BEGIN SELECT RAISE(ABORT,'range decisions are append-only'); END;
CREATE TRIGGER range_decisions_no_delete BEFORE DELETE ON range_decisions BEGIN SELECT RAISE(ABORT,'range decisions are append-only'); END;
`;
