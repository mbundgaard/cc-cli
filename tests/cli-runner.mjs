// Unpackaged dependency injection; production has no directory override or test-read command.
import path from 'node:path';
import { main } from './test-read.mjs';
import { StateStore } from '../dist/state.js';
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory)) throw new Error('Absolute isolated test directory required');
process.exitCode = await main([process.execPath, 'cc', ...process.argv.slice(3)], new StateStore(directory));
