// SPDX-License-Identifier: Apache-2.0
const appendOnly = (table:string) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'memory history is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'memory history is append-only'); END;`;
const payload = `payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL`;
/** Additive v4 tables. No reconstruction of earlier documents/source/analysis tables. */
export const MEMORY_SQL = `
CREATE TABLE writing_profiles(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,${payload}) STRICT;
CREATE TABLE profile_bindings(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),profile_id TEXT REFERENCES writing_profiles(id),${payload}) STRICT;
CREATE INDEX profile_bindings_document ON profile_bindings(document_id,seq);
CREATE TABLE memory_task_runs(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),revision_id TEXT NOT NULL REFERENCES revisions(id),${payload}) STRICT;
CREATE TABLE intent_versions(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),revision_id TEXT NOT NULL REFERENCES revisions(id),run_id TEXT REFERENCES memory_task_runs(id),${payload}) STRICT;
CREATE TABLE intent_confirmations(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),intent_id TEXT NOT NULL REFERENCES intent_versions(id),${payload}) STRICT;
CREATE INDEX intent_document ON intent_versions(document_id,seq);
CREATE INDEX intent_confirmed_document ON intent_confirmations(document_id,seq);
CREATE TABLE preference_versions(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,preference_id TEXT NOT NULL,profile_id TEXT NOT NULL REFERENCES writing_profiles(id),previous_id TEXT REFERENCES preference_versions(id),run_id TEXT REFERENCES memory_task_runs(id),${payload}) STRICT;
CREATE INDEX preferences_profile ON preference_versions(profile_id,seq);
CREATE INDEX preferences_identity ON preference_versions(preference_id,seq);
CREATE TABLE guidance_uses(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id),revision_id TEXT NOT NULL REFERENCES revisions(id),${payload}) STRICT;
CREATE TABLE change_guidance(change_id TEXT PRIMARY KEY NOT NULL REFERENCES changes(id),use_id TEXT NOT NULL REFERENCES guidance_uses(id)) STRICT;
CREATE TABLE decision_reasons(decision_id TEXT PRIMARY KEY NOT NULL REFERENCES decisions(id),category TEXT NOT NULL CHECK(category IN ('meaning','certainty','voice','unnecessary','content','other'))) STRICT;
` + ['writing_profiles','profile_bindings','memory_task_runs','intent_versions','intent_confirmations','preference_versions','guidance_uses','change_guidance','decision_reasons'].map(appendOnly).join('\n');
