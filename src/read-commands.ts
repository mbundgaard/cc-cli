import { Command, Option } from 'commander';
import { baseUrl, type State, StateStore } from './state.js';
import { executeQuery, type PreparedRequest, type QueryOptions } from './requests.js';
import { CliError, Exit } from './output.js';
import { prepareLearning } from './catalogue-commands.js';

export const readDefinitions = [
  { id: 'server-version', command: 'server-version', summary: 'Deployed Simphony Enterprise and CC API releases',
    paths: { v1: '/config/sim/v1/getReleaseVersions', v2: '/config/sim/v2/getReleaseVersions' }, scope: 'environment-version' },
] as const;
export type ReadId = typeof readDefinitions[number]['id'];
export type ReadOptions = QueryOptions & { apiVersion?: 'v1' | 'v2' };
export function buildReadRequest(id: ReadId, state: State, input: Record<string, unknown>, options: ReadOptions): PreparedRequest {
  const definition = readDefinitions.find(item => item.id === id);
  if (!definition) throw new CliError(Exit.usage, 'Unsupported CC read operation');
  const apiVersion = options.apiVersion ?? 'v2';
  if (apiVersion !== 'v1' && apiVersion !== 'v2') throw new CliError(Exit.usage, 'API version must be v1 or v2');
  if (Object.keys(input).length) throw new CliError(Exit.usage, 'Server version takes an empty request body');
  if (!state.auth.apiUrl || !state.auth.orgName) throw new CliError(Exit.notConfigured, 'Configure the CC API URL and enterprise shortname first');
  return { method: 'POST', url: baseUrl(state.auth.apiUrl) + definition.paths[apiVersion],
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: {}, scope: definition.scope };
}
export function readOptions(command: Command): Command {
  return command.addOption(new Option('--api-version <version>', 'Explicit contract; no automatic fallback').choices(['v1', 'v2']).default('v2'))
    .option('--dry-run', 'Show the explicit request without tokens, network or state changes')
    .option('--quiet', 'Suppress HTTP status and update notices (not errors)')
    .option('--timeout <seconds>', 'Positive per-request timeout, at most 300 seconds', value => {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) throw new CliError(Exit.usage, 'Timeout must be greater than 0 and at most 300');
      return seconds;
    }, 30);
}
export function registerReads(root: Command, store: StateStore, setExit: (code: number) => void): void {
  readOptions(root.command('server-version').description('[read-only][network] Deployed Enterprise and CC API versions, not this CLI version'))
    .addHelpText('after', '\nOne POST with an empty JSON body. v2 by default; explicit v1 is supported.\nNo discovery, retries, fallback or configuration changes. Dry-run stays offline.\nSuccessful reads use the shared due-token renewal and verbatim delivery lifecycle.\n')
    .action(async options => { setExit(await executeQuery('getReleaseVersions', store, options,
      (state, input) => buildReadRequest('server-version', state, input, options), store.directory, undefined,
      async state => prepareLearning(store.directory, state, 'server-version', options.apiVersion))); });
}
