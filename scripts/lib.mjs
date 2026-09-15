import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const root = fileURLToPath(new URL('../', import.meta.url));
export function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
export function tsc(...args) {
  const compiler = resolve(root, 'node_modules/typescript/bin/tsc');
  if (!existsSync(compiler)) {
    console.error('Dependencies missing. Run pnpm install first.'); process.exit(1);
  }
  run([compiler, ...args]);
}
export function tests() {
  const dir = resolve(root, 'tests/dist');
  const files = readdirSync(dir).filter(n => n.endsWith('.test.js')).sort().map(n => resolve(dir, n));
  if (files.length === 0) { console.error('No tests found.'); process.exit(1); }
  run(['--test', ...files]);
}
