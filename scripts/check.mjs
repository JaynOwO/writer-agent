import { checkReadmes } from './check-readme-parity.mjs';
import { tsc, tests } from './lib.mjs';
tsc('-p', 'tsconfig.check.json');
tsc('-b');
tests();
checkReadmes();
