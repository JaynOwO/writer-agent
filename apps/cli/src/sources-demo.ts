// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '@writer-agent/storage';
import { MockModelProvider } from '@writer-agent/models';
import { suggestChanges } from './suggest.js';
import { exportSource } from './source-command.js';
/** Complete offline source workflow with synthetic text and a scripted provider, not real research/inference. */
export async function sourcesDemo():Promise<void> {
  const root=mkdtempSync(join(tmpdir(),'siglum-sources-demo-'));
  const w=Workspace.create(join(root,'workspace'),'Siglum sources demo');
  try {
    const imported=w.sources.add({kind:'file',locator:'synthetic-report.html',mediaType:'text/html',raw:Buffer.from('<html><head><title>演示研究 / Demo study</title><meta name="author" content="Fictional researcher"></head><body><h1>示例资料</h1><p>这份虚构资料只说明两项变化同时出现，不证明因果。</p><p>Further evidence is needed.</p><script>never execute this</script></body></html>')});
    const line=imported.snapshot.text.split('\n').findIndex(s=>s.includes('虚构资料'))+1;
    const excerpt=w.sources.extract(imported.snapshot.id,line,line);
    w.sources.note(imported.snapshot.id,'这是一条演示笔记，不是经过验证的事实。',excerpt.id);
    const d=w.createDocument('演示文稿','这项变化可能与另一项变化有关。\n\n这一段是一段比较冗长的说明。');
    const first=w.currentRevision(d.id).snapshot.blocks[0]!;
    w.sources.bind(d.id,first.id,excerpt.id);
    const model=new MockModelProvider([{before:first.text,after:'两项变化可能相关。',summary:'保留不确定性，仅精简。'}]);
    const result=await suggestChanges(w,d.id,'精简，不增强因果语气。',model,undefined,{excerpts:[excerpt.id]});
    assert.equal(w.markdown(d.id).split('\n')[0],first.text);
    const change=result.changes[0]!;
    const provenance=w.sources.provenance(change.id)!;
    assert.equal(provenance.items[0]?.snapshotId,imported.snapshot.id);
    assert.equal(provenance.verification,'supplied-not-verified');
    w.accept(change.id,'接受润色');assert.equal(w.sources.bindings(d.id)[0]?.state,'stale');
    w.revert(change.id,'保留初稿');assert.equal(w.markdown(d.id).split('\n')[0],first.text);
    const exported=exportSource(w,imported.snapshot.id,join(root,'source-export'));
    console.log('Siglum v0.0.5 — offline source workflow (synthetic source / scripted model; no network)');
    console.log(JSON.stringify({workspace:w.root,sourceId:imported.source.id,snapshotId:imported.snapshot.id,excerptId:excerpt.id,
      provenance:'supplied-not-verified',bindingAfterEditAndRevert:'stale; no automatic re-approval',exported},null,2));
    console.log('SOURCES_DEMO_OK');
  }finally{w.close();}
}
