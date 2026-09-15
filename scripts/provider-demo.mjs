// SPDX-License-Identifier: Apache-2.0
import { tsc, run } from './lib.mjs';
tsc('-b');
run(['apps/cli/dist/provider-demo.js']);
