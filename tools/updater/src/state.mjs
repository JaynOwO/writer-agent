// SPDX-License-Identifier: Apache-2.0
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, chmodSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { newId, now, fingerprint, insist, ordinary, atomicJson } from './common.mjs';
export class UpdateStore {
  constructor(root) {
    mkdirSync(root,{recursive:true,mode:0o700});ordinary(root,'directory');this.root=root;
    for(const sub of ['cache','worktrees','logs','downloads','hooks']){mkdirSync(join(root,sub),{recursive:true,mode:0o700});ordinary(join(root,sub),'directory');}
    const path=join(root,'state.sqlite');ordinary(path,'file',true);this.db=new DatabaseSync(path,{timeout:5000});
    if(process.platform!=='win32')chmodSync(path,0o600);

    try {
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    insist(version===0||version===1,'STATE_SCHEMA','Unknown updater state version; no reset attempted.');
    if(version===0){insist(this.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n===0,'STATE_SCHEMA','The state path contains an unrelated database.');this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
      CREATE TABLE tasks(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE events(seq INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL) STRICT;
      CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'append-only'); END;
      CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'append-only'); END;
      PRAGMA application_id=1397183812; PRAGMA user_version=1; COMMIT;`);}
    insist(this.db.prepare('PRAGMA application_id').get().application_id===1397183812,'STATE_SCHEMA','Not a Siglum Updater database.');
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
    }catch(e){this.db.close();throw e;}
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  create(data){const t={...data,id:newId(),revision:1,createdAt:now(),updatedAt:now(),state:'prepared',pendingAction:null,error:null,historyWarnings:[],remoteMerged:false,localSynced:false,cleanupComplete:false};this.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run(t.id,t.revision,JSON.stringify(t),fingerprint(t),t.createdAt);return t;}
  get(id){const r=this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);insist(r,'TASK_NOT_FOUND','Update task does not exist.');let t;try{t=JSON.parse(r.data);}catch{insist(false,'STATE_CORRUPT','Task JSON is corrupt.');}insist(fingerprint(t)===r.hash&&t.id===id&&t.revision===r.revision,'STATE_CORRUPT','Task integrity check failed.');return t;}
  list(){return this.db.prepare('SELECT id FROM tasks ORDER BY created_at DESC,id').all().map(r=>this.get(r.id));}
  change(id,expected,patch,kind='checkpoint'){
    return this.transaction(()=>{const old=this.get(id);insist(old.revision===expected,'TASK_STALE','Task was changed by another session.');const t={...old,...patch,id,revision:old.revision+1,updatedAt:now()};const r=this.db.prepare('UPDATE tasks SET revision=?,data=?,hash=? WHERE id=? AND revision=?').run(t.revision,JSON.stringify(t),fingerprint(t),id,expected);insist(r.changes===1,'TASK_STALE','Task update conflicted.');this.db.prepare('INSERT INTO events(task_id,kind,data,at) VALUES(?,?,?,?)').run(id,kind,JSON.stringify(patch),now());return t;});
  }
  event(id,kind,data){this.get(id);this.db.prepare('INSERT INTO events(task_id,kind,data,at) VALUES(?,?,?,?)').run(id,kind,JSON.stringify(data),now());}
  events(id){this.get(id);return this.db.prepare('SELECT seq,kind,data,at FROM events WHERE task_id=? ORDER BY seq').all(id).map(r=>({...r,data:JSON.parse(r.data)}));}
  close(){if(!this.closed){this.db.close();this.closed=true;}}
}
/** Cooperative Git-common-directory lock. No expiry-based stealing of live processes. */
export function acquireRepositoryLock(commonDir,taskId,recover=false){
  ordinary(commonDir,'directory');const path=join(commonDir,'siglum-updater-v02.lock'),nonce=newId();
  if(existsSync(path)){
    ordinary(path);let old;try{old=JSON.parse(readFileSync(path,'utf8'));}catch{insist(false,'REPOSITORY_LOCKED','Unknown lock file requires inspection; it was not removed.');}
    let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
    insist(recover&&!alive&&old.tool==='siglum-updater/0.2'&&old.taskId===taskId,'REPOSITORY_LOCKED','Another updater may own this repository. Recover only the recorded dead task.');
    // Recheck the exact owner bytes; never remove another process's replacement lock.
    const expected=JSON.stringify(old);insist(JSON.stringify(JSON.parse(readFileSync(path,'utf8')))===expected,'REPOSITORY_LOCKED','Lock changed during recovery.');unlinkSync(path);
  }
  const record={tool:'siglum-updater/0.2',taskId,pid:process.pid,nonce,at:now()},fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);}finally{closeSync(fd);}
  return ()=>{try{ordinary(path);const current=JSON.parse(readFileSync(path,'utf8'));if(current.nonce===nonce&&current.taskId===taskId)unlinkSync(path);}catch{}};
}
export function readConfig(root){const p=join(root,'config.json');if(!existsSync(p))return null;ordinary(p);const c=JSON.parse(readFileSync(p,'utf8'));insist(c.format===1&&typeof c.repoPath==='string','CONFIG_INVALID','Unknown updater configuration.');return c;}
export function saveConfig(root,config){const path=join(root,'config.json');if(existsSync(path))atomicJson(join(root,`config-backup-${newId()}.json`),JSON.parse(readFileSync(path,'utf8')));atomicJson(path,{...config,format:1});}
