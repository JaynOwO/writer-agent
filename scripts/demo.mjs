import { tsc, run, root } from './lib.mjs';
import { resolve } from 'node:path';
tsc('-b');
run([resolve(root, 'apps/cli/dist/index.js'), 'demo', ...process.argv.slice(2)]);
