// SPDX-License-Identifier: Apache-2.0
import type { SecretStore } from '../../apps/cli/src/application/secrets.js';
import type { PresetSettings } from '../../apps/cli/src/application/presets.js';
import { workflowConfig } from './workflow-helpers.js';
export const { ConnectionStore, presetRef, attachPreset } = await import(new URL('../../apps/cli/dist/application/presets.js', import.meta.url).href) as typeof import('../../apps/cli/src/application/presets.js');
export const { ProductError, credentialSelfTest, OsSecretStore } = await import(new URL('../../apps/cli/dist/application/secrets.js', import.meta.url).href) as typeof import('../../apps/cli/src/application/secrets.js');
export const { presetDependencies, modelFromPreset } = await import(new URL('../../apps/cli/dist/application/connections-runtime.js', import.meta.url).href) as typeof import('../../apps/cli/src/application/connections-runtime.js');
export const { localDiagnostics, recoveryView, prepareProbe, runProbe } = await import(new URL('../../apps/cli/dist/application/diagnostics.js', import.meta.url).href) as typeof import('../../apps/cli/src/application/diagnostics.js');
export const { reportSnapshot, renderReadingReport, writeReadingReport, safeReportLink, escapeHtml } = await import(new URL('../../apps/cli/dist/application/report.js', import.meta.url).href) as typeof import('../../apps/cli/src/application/report.js');
export const { runProductGuide } = await import(new URL('../../apps/cli/dist/product-guide.js', import.meta.url).href) as typeof import('../../apps/cli/src/product-guide.js');
export class FakeSecrets implements SecretStore {
    readonly backend = 'isolated-memory-test-not-os';
    values = new Map<string, string>();
    reads = 0;
    writes = 0;
    removes = 0;
    async read(id: string) { this.reads++; return this.values.get(id) ?? null; }
    async write(id: string, value: string) { this.writes++; this.values.set(id, value); }
    async remove(id: string) { this.removes++; return this.values.delete(id); }
}
export function settings(baseURL = 'http://127.0.0.1:11434'): PresetSettings { return { kind: 'model', model: { ...workflowConfig().model, baseURL, apiKeyEnv: null } }; }
