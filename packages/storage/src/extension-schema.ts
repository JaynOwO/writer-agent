// SPDX-License-Identifier: Apache-2.0
const immutable = (table: string) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'${table} is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'${table} is append-only'); END;
`;
export const EXTENSION_SQL = `
CREATE TABLE skill_packages (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, content_hash TEXT UNIQUE NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL) STRICT;
CREATE TABLE skill_decisions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, package_id TEXT NOT NULL REFERENCES skill_packages(id), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL) STRICT;
CREATE TABLE mcp_servers (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL) STRICT;
CREATE TABLE mcp_trust (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, server_id TEXT NOT NULL REFERENCES mcp_servers(id), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL) STRICT;
CREATE TABLE mcp_catalogs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, server_id TEXT NOT NULL REFERENCES mcp_servers(id), payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL) STRICT;
CREATE TABLE source_provenance (snapshot_id TEXT PRIMARY KEY NOT NULL REFERENCES source_snapshots(id), payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL) STRICT;
CREATE TABLE research_indexes (cache_key TEXT PRIMARY KEY NOT NULL, snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id), payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL) STRICT;
CREATE TABLE citation_maps (id TEXT PRIMARY KEY NOT NULL, artifact_id TEXT NOT NULL REFERENCES workflow_artifacts(id), document_id TEXT REFERENCES documents(id), revision_id TEXT REFERENCES revisions(id), payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL) STRICT;
CREATE UNIQUE INDEX citation_candidate_unique ON citation_maps(artifact_id) WHERE document_id IS NULL;
CREATE UNIQUE INDEX citation_document_unique ON citation_maps(artifact_id,document_id) WHERE document_id IS NOT NULL;
${['skill_packages','skill_decisions','mcp_servers','mcp_trust','mcp_catalogs','source_provenance','citation_maps'].map(immutable).join('')}
`;
