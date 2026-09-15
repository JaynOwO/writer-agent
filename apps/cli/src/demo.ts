import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockModelProvider } from '@writer-agent/models';
import { renderMarkdown } from '@writer-agent/core';
import { Workspace } from '@writer-agent/storage';

export async function demo(directory?: string): Promise<void> {
  const root = directory ?? join(mkdtempSync(join(tmpdir(), 'writer-agent-demo-')), 'workspace');
  const workspace = Workspace.create(root, '离线演示');
  try {
    const first = '研究人员认为，新工具可能会改变部分岗位的工作内容。';
    const second = '这段说明很长很长，但是它只是一个用于演示的句子。';
    const third = '证据不足时，应当保留限定条件。';
    const document = workspace.createDocument('虚构测试文案', `${first}\n\n${second}\n\n${third}`);
    const revision = workspace.currentRevision(document.id);
    const provider = new MockModelProvider([
      { before: first, after: '新工具导致岗位消失。', summary: '危险示例：移除限定、归因并加入因果断言' },
      { before: second, after: '这是一段用于演示的说明。', summary: '缩短说明句' },
      { before: third, after: '', summary: '删除结尾限定提醒（将被拒绝）' },
    ]);
    const response = await provider.propose({ documentId: document.id, baseRevisionId: revision.id, snapshot: revision.snapshot, instruction: '返回预先编写的三项测试修改。' });
    const changes = workspace.proposeChanges(response.documentId, response.baseRevisionId, response.edits, response.providerId);
    const [risky, style, deletion] = changes;
    if (!risky || !style || !deletion) throw new Error('Demo fixture is incomplete.');
    console.log('Siglum v0.0.4 — 离线核心演示');
    console.log('以下为虚构测试文案。Mock 不是 AI，规则提示不是事实核查。\n');
    console.log(`工作区：${workspace.root}`);
    console.log(`文稿 ID：${document.id}\n`);
    console.log('修改 1：');
    console.log(`- ${risky.before}\n+ ${risky.after}`);
    for (const hint of risky.hints) console.log(`[${hint.code}] ${hint.message}`);
    workspace.accept(risky.id, '演示：先接受，再单独撤回');
    workspace.accept(style.id, '保留这一项风格修改');
    workspace.reject(deletion.id, '保留证据不足时的限定提醒');
    const final = workspace.revert(risky.id, '原文没有因果证据，不接受这一表述');
    const markdown = renderMarkdown(final.snapshot);
    const exported = join(workspace.root, 'demo-final.md');
    writeFileSync(exported, markdown, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    console.log('\n已接受两项、拒绝一项，再仅撤回第一项。第二项的修改仍保留。\n');
    console.log(markdown);
    console.log(`\n版本数：${workspace.history(document.id).length}；决策记录：${workspace.decisions(document.id).length}`);
    console.log(`Markdown 导出：${exported}`);
    console.log('DEMO_OK');
  } finally { workspace.close(); }
}
