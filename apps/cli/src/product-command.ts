// SPDX-License-Identifier: Apache-2.0
import { Workspace } from '@writer-agent/storage';
import { ProductError } from './application/secrets.js';
import { ConnectionStore } from './application/presets.js';
import { localDiagnostics, recoveryView } from './application/diagnostics.js';
import { reportSnapshot, writeReadingReport } from './application/report.js';
import { openTerminal, WizardCancelled, terminalText } from './terminal.js';
import { runProductGuide } from './product-guide.js';
const help = `Siglum v0.0.8 product tools
  siglum product guide <workspace> [--lang zh-CN|en]
  siglum product doctor [workspace]
  siglum product presets
  siglum product recovery <workspace> <runId>
  siglum product report <workspace> run|document <id> <new.html> [--text] [--sources] [--guidance] [--lang zh-CN|en]
  siglum product demo
Guide stores named presets; keys use masked input and explicit OS/env/session selection.
Doctor is local metadata only; no network, credential reads/unlock or service launch.
Report flags explicitly select private content. No flags means metadata only; no overwrite.
No automatic model calls, third-party launches, workspace migrations or repository writes.`;
function need(ok: boolean): asserts ok { if (!ok)
    throw new ProductError('PRODUCT_ARGS', 'Invalid arguments. Run siglum product help.'); }
const print = (v: unknown) => console.log(terminalText(JSON.stringify(v, null, 2)));
export async function productCommand(args: string[]): Promise<void> {
    const [action = 'help', ...rest] = args;
    if (action === 'help') {
        need(!rest.length);
        console.log(help);
        return;
    }
    if (action === 'demo') {
        need(!rest.length);
        await (await import('./product-demo.js')).productDemo();
        return;
    }
    if (action === 'presets') {
        need(!rest.length);
        print(new ConnectionStore().list());
        return;
    }
    if (action === 'doctor') {
        need(rest.length <= 1);
        const w = rest[0] ? Workspace.open(rest[0]) : null;
        try {
            print(localDiagnostics(w));
        }
        finally {
            w?.close();
        }
        return;
    }
    need(['guide', 'report', 'recovery'].includes(action) && !!rest[0]);
    const w = Workspace.open(rest[0]!);
    try {
        if (action === 'guide') {
            need(rest.length === 1 || (rest.length === 3 && rest[1] === '--lang' && ['zh-CN', 'en'].includes(rest[2]!)));
            const t = openTerminal();
            try {
                await runProductGuide(w, t.io, rest[2] === 'en' ? 'en' : 'zh-CN');
            }
            catch (e) {
                if (e instanceof WizardCancelled)
                    t.io.line('Cancelled / 已取消。');
                else
                    throw e;
            }
            finally {
                t.close();
            }
            return;
        }
        if (action === 'recovery') {
            need(rest.length === 2);
            print(recoveryView(w, rest[1]!));
            return;
        }
        need(rest.length >= 4 && ['run', 'document'].includes(rest[1]!));
        const opts = { language: 'zh-CN' as 'zh-CN' | 'en', includeText: false, includeSources: false, includeGuidance: false };
        const seen = new Set<string>();
        for (let i = 4; i < rest.length; i++) {
            const f = rest[i]!;
            need(!seen.has(f));
            seen.add(f);
            if (f === '--text')
                opts.includeText = true;
            else if (f === '--sources')
                opts.includeSources = true;
            else if (f === '--guidance')
                opts.includeGuidance = true;
            else if (f === '--lang') {
                const l = rest[++i];
                need(l === 'en' || l === 'zh-CN');
                opts.language = l;
            }
            else
                need(false);
        }
        const report = reportSnapshot(w, { ...opts, ...(rest[1] === 'run' ? { runId: rest[2]! } : { documentId: rest[2]! }) });
        writeReadingReport(rest[3]!, report);
        print({ status: 'saved', scope: report.scope, generatedAt: report.generatedAt });
    }
    finally {
        w.close();
    }
}
