import { tsc, tests } from './lib.mjs';
tsc('-p', 'tsconfig.check.json');
tsc('-b');
tests();
