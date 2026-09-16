import { tsc, run } from './lib.mjs';
tsc('-b');
run(['apps/cli/dist/index.js','product','demo']);
