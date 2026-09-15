import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './lib.mjs';
for (const path of ['packages/core/dist','packages/models/dist','packages/storage/dist','apps/cli/dist','tests/dist']) {
  rmSync(resolve(root, path), { recursive: true, force: true });
}
