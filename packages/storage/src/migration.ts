// SPDX-License-Identifier: Apache-2.0
import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WriterError, requireString } from '@writer-agent/core';
import { APPLICATION_ID, SCHEMA_VERSION } from './schema.js';
import { SOURCES_SQL } from './source-schema.js';
function ordinary(path:string,directory:boolean) {
  if(!existsSync(path))throw new WriterError('NOT_FOUND','Workspace path does not exist.');
  const s=lstatSync(path);if(s.isSymbolicLink()||!(directory?s.isDirectory():s.isFile()))throw new WriterError('INVALID_INPUT','Migration requires ordinary workspace paths, not symlinks.');
}
function versionOf(db:DatabaseSync):number {
  if(db.prepare('PRAGMA application_id').get()?.application_id!==APPLICATION_ID)throw new WriterError('UNSUPPORTED_SCHEMA','Not a Writer Agent / Siglum workspace.');
  const version=db.prepare('PRAGMA user_version').get()?.user_version;
  if(version!==1&&version!==SCHEMA_VERSION)throw new WriterError('UNSUPPORTED_SCHEMA','Unknown schema; no migration attempted.');return version;
}
/** Explicit additive migration. Preview writes no application data. Never triggered by source-code updates. */
export function migrateWorkspace(directory:string,apply=false) {
  requireString(directory,'workspace',4096);
  const root=resolve(directory),state=join(root,'.writer'),path=join(state,'workspace.sqlite'),lock=join(state,'migration.lock');
  ordinary(root,true);ordinary(state,true);ordinary(path,false);
  if(existsSync(lock))throw new WriterError('WORKSPACE_BUSY','A migration lock exists. Inspect it; do not delete an active lock.');
  let db=new DatabaseSync(path,{readOnly:true,timeout:5000});
  let version:number;
  try{version=versionOf(db);}finally{db.close();}
  if(!apply||version===SCHEMA_VERSION)return {applied:false,from:version,to:SCHEMA_VERSION,needed:version!==SCHEMA_VERSION,backup:null};
  // The lock coordinates current Siglum processes. Close older program versions before migration.
  let fd:number;
  try{fd=openSync(lock,'wx',0o600);}catch{throw new WriterError('WORKSPACE_BUSY','Could not exclusively lock the migration.');}
  try{writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()})+'\n');}finally{closeSync(fd);}
  let backupPath:string|null=null,opened=false,inTransaction=false;
  try {
    db=new DatabaseSync(path,{timeout:5000});opened=true;
    version=versionOf(db);
    if(version===SCHEMA_VERSION)return {applied:false,from:version,to:SCHEMA_VERSION,needed:false,backup:null};
    const before=db.prepare('PRAGMA data_version').get()?.data_version;
    const backups=join(state,'backups');
    if(existsSync(backups))ordinary(backups,true);else mkdirSync(backups,{mode:0o700});
    const dest=mkdtempSync(join(backups,'schema-v1-'));if(process.platform!=='win32')chmodSync(dest,0o700);
    backupPath=join(dest,'workspace.sqlite');
    // VACUUM INTO makes a consistent SQLite snapshot, including committed WAL data.
    // It is not a raw file copy and refuses a nonempty existing destination.
    db.prepare('VACUUM main INTO ?').run(backupPath);
    if(process.platform!=='win32')chmodSync(backupPath,0o600);
    const check=new DatabaseSync(backupPath,{readOnly:true});
    try {
      if(versionOf(check)!==1||check.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw new WriterError('CORRUPT_DATA','Backup verification failed; original schema was not changed.');
    }finally{check.close();}
    db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');inTransaction=true;
    if(versionOf(db)!==1||db.prepare('PRAGMA data_version').get()?.data_version!==before)throw new WriterError('WORKSPACE_BUSY','Workspace changed during backup. Close other sessions and retry; backup retained.');
    db.exec(SOURCES_SQL);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new WriterError('CORRUPT_DATA','Workspace foreign-key check failed.');
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);inTransaction=false;
    return {applied:true,from:1,to:SCHEMA_VERSION,needed:false,backup:backupPath};
  } catch(error) {
    if(inTransaction){try{db.exec('ROLLBACK');}catch{/* The original error is retained. */}}
    if(error instanceof WriterError)throw error;
    throw new WriterError('CORRUPT_DATA','Migration failed; no committed partial schema. Keep the retained backup and inspect the workspace.');
  } finally {
    if(opened)db.close();unlinkSync(lock);
  }
}
