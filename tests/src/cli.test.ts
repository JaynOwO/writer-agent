import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { Workspace } from '@writer-agent/storage';
import { temporary } from './helpers.js';
const cli = fileURLToPath(new URL('../../apps/cli/dist/index.js', import.meta.url));
function run(args: string[]) { return spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:20000}); }
function success(args: string[]) {
  const r=run(args);assert.equal(r.status,0,`${r.stderr}\n${r.stdout}`);return r.stdout;
}
test('CLI displays help without workspace or model credentials', () => {
  assert.match(success(['help']),/no API key needed/);
});
test('CLI demo executes complete offline workflow and exports final Markdown', t => {
  const dir=join(temporary(t),'演示 workspace');
  const output=success(['demo',dir]);assert.match(output,/DEMO_OK/);
  const file=readFileSync(join(dir,'demo-final.md'),'utf8');
  assert.match(file,/研究人员认为/);assert.match(file,/这是一段用于演示的说明。/);assert.doesNotMatch(file,/导致岗位消失/);
  const w=Workspace.open(dir);try{const d=w.listDocuments()[0];assert.ok(d);assert.equal(w.history(d.id).length,4);}finally{w.close();}
});
test('CLI supports init/import/show/propose/accept/export with UTF-8 and spaced paths', t => {
  const root=temporary(t);const dir=join(root,'my workspace');const input=join(root,'我的文稿.md');
  writeFileSync(input,'甲可能成立。\r\n\r\n乙。');success(['init',dir,'My workspace']);
  const d=JSON.parse(success(['import',dir,input])) as {id:string};
  const view=JSON.parse(success(['show',dir,d.id])) as {revision:{id:string;snapshot:{blocks:{id:string;text:string}[]}}};
  const block=view.revision.snapshot.blocks[0];assert.ok(block);
  const proposal=join(root,'proposal.json');writeFileSync(proposal,JSON.stringify({baseRevisionId:view.revision.id,edits:[{blockId:block.id,before:block.text,after:'甲成立。',summary:'测试修改'}]}));
  const changes=JSON.parse(success(['propose',dir,d.id,proposal])) as {id:string}[];assert.ok(changes[0]);
  success(['accept',dir,changes[0].id,'test reason']);const output=join(root,'out.md');success(['export',dir,d.id,output]);
  assert.equal(readFileSync(output,'utf8'),'甲成立。\r\n\r\n乙。');
  success(['revert',dir,changes[0].id]);
  const decisions=JSON.parse(success(['decisions',dir,d.id])) as unknown[];assert.equal(decisions.length,2);
});
test('CLI refuses to overwrite an export destination', t => {
  const root=temporary(t);const dir=join(root,'workspace');const w=Workspace.create(dir);const d=w.createDocument('title','new');w.close();
  const output=join(root,'keep.md');writeFileSync(output,'KEEP');const r=run(['export',dir,d.id,output]);
  assert.notEqual(r.status,0);assert.match(r.stderr,/EEXIST/);assert.equal(readFileSync(output,'utf8'),'KEEP');
});
test('CLI reports unknown commands and bad argument counts as errors', () => {
  assert.equal(run(['not-a-command']).status,2);assert.equal(run(['accept']).status,2);
});
test('CLI refuses malformed JSON and invalid UTF-8 without changes', t => {
  const root=temporary(t);const dir=join(root,'workspace');const w=Workspace.create(dir);const d=w.createDocument('title','a');w.close();
  const file=join(root,'bad.json');writeFileSync(file,'{bad');assert.equal(run(['propose',dir,d.id,file]).status,2);
  const invalid=join(root,'invalid.md');writeFileSync(invalid,Buffer.from([0xff,0xfe,0xff]));assert.equal(run(['import',dir,invalid]).status,2);
  const again=Workspace.open(dir);try{assert.equal(again.listChanges(d.id).length,0);assert.equal(again.listDocuments().length,1);}finally{again.close();}
});
