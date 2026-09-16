// SPDX-License-Identifier: Apache-2.0
import {readdirSync} from 'node:fs';import {join} from 'node:path';import {run,root} from './lib.mjs';
for(const dir of ['apps/desktop/test','tools/updater/test'])run(['--test','--test-concurrency=4',...readdirSync(join(root,dir)).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>join(root,dir,n))]);
