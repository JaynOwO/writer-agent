// SPDX-License-Identifier: Apache-2.0
export const WORKFLOW_SQL=`
CREATE TABLE workflow_runs (
 id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, owner TEXT, generation INTEGER NOT NULL DEFAULT 0,
 expires_at INTEGER NOT NULL DEFAULT 0, accounted_at INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE workflow_grants (
 id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES workflow_runs(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL,
 active_ms INTEGER NOT NULL DEFAULT 0 CHECK(active_ms>=0)
) STRICT;
CREATE TABLE workflow_attempts (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,run_id TEXT NOT NULL REFERENCES workflow_runs(id),
 grant_id TEXT NOT NULL REFERENCES workflow_grants(id), step_key TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),payload_hash TEXT NOT NULL
) STRICT;
CREATE INDEX workflow_attempt_run ON workflow_attempts(run_id,seq);
CREATE TABLE workflow_artifacts (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,run_id TEXT NOT NULL REFERENCES workflow_runs(id),step_key TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),payload_hash TEXT NOT NULL,UNIQUE(run_id,step_key)
) STRICT;
CREATE TABLE workflow_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,run_id TEXT NOT NULL REFERENCES workflow_runs(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)),payload_hash TEXT NOT NULL
) STRICT;
CREATE TRIGGER workflow_artifacts_no_update BEFORE UPDATE ON workflow_artifacts BEGIN SELECT RAISE(ABORT,'workflow artifacts are append-only'); END;
CREATE TRIGGER workflow_artifacts_no_delete BEFORE DELETE ON workflow_artifacts BEGIN SELECT RAISE(ABORT,'workflow artifacts are append-only'); END;
CREATE TRIGGER workflow_events_no_update BEFORE UPDATE ON workflow_events BEGIN SELECT RAISE(ABORT,'workflow events are append-only'); END;
CREATE TRIGGER workflow_events_no_delete BEFORE DELETE ON workflow_events BEGIN SELECT RAISE(ABORT,'workflow events are append-only'); END;
`;
