// Unpackaged synthetic request harness. Never registered by the production CLI.
import { CommanderError } from 'commander';
import { createProgram } from '../dist/cli.js';
import { executeQuery, stringField } from '../dist/requests.js';
import { CliError, Exit, reportError } from '../dist/output.js';
export function executeTestRead(store, options, directory = store.directory, notify = async () => {}) {
  return executeQuery('testRead', store, options, (state, input) => {
    const body = {...input};
    if (options.locRef !== undefined) body.locRef = options.locRef;
    stringField(body, 'locRef', 99);
    if (body.locRef === undefined) throw new CliError(Exit.usage, 'Synthetic test requires explicit locRef');
    // This path is a loopback fixture, not a CCAPI endpoint implementation.
    const url = new URL(state.auth.apiUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Test harness is loopback only');
    return {method: 'POST', url: `${url.origin}/test-only/${encodeURIComponent(state.auth.orgName)}/read`,
      headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body, scope: 'synthetic-test-only'};
  }, directory, notify);
}
export async function main(argv, store, notify = async () => {}) {
  let code = Exit.ok;
  try {
    const program = createProgram(store, result => { code = result; });
    program.command('test-read').option('--loc-ref <value>').option('--json <object>').option('--file <path>')
      .option('--dry-run').option('--quiet').option('--timeout <seconds>', 'Synthetic timeout', Number)
      .action(async options => { code = await executeTestRead(store, options, store.directory, notify); });
    await program.parseAsync(argv); return code;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : reportError(new CliError(Exit.usage, 'Invalid synthetic test invocation'));
    return reportError(error);
  }
}
