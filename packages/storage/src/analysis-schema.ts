// SPDX-License-Identifier: Apache-2.0
/** Additive schema. These are annotations, not manuscript approval or truth tables. */
export const ANALYSIS_SQL = `
CREATE TABLE ledger_claims (
  id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL REFERENCES documents(id), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE analysis_runs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id), revision_id TEXT NOT NULL REFERENCES revisions(id),
  task TEXT NOT NULL CHECK(task IN ('claim-extraction','semantic-review')),
  payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL
) STRICT;
CREATE TABLE claim_occurrences (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
  claim_id TEXT NOT NULL REFERENCES ledger_claims(id), document_id TEXT NOT NULL REFERENCES documents(id),
  revision_id TEXT NOT NULL REFERENCES revisions(id), run_id TEXT REFERENCES analysis_runs(id),
  payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL
) STRICT;
CREATE TABLE claim_decisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
  claim_id TEXT NOT NULL REFERENCES ledger_claims(id), occurrence_id TEXT NOT NULL REFERENCES claim_occurrences(id),
  document_id TEXT NOT NULL REFERENCES documents(id),
  payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL
) STRICT;
CREATE TABLE analysis_feedback (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, run_id TEXT NOT NULL REFERENCES analysis_runs(id),
  payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL
) STRICT;
CREATE TABLE claim_evidence (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
  occurrence_id TEXT NOT NULL REFERENCES claim_occurrences(id),
  payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL
) STRICT;
CREATE INDEX occurrences_document ON claim_occurrences(document_id,seq);
CREATE INDEX analysis_document ON analysis_runs(document_id,seq);
CREATE INDEX claim_decisions_document ON claim_decisions(document_id,seq);
` + ['ledger_claims', 'analysis_runs', 'claim_occurrences', 'claim_decisions', 'analysis_feedback', 'claim_evidence'].map(table => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'analysis history is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'analysis history is append-only'); END;
`).join('');
