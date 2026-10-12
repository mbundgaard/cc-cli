import { Command, Option } from 'commander';
import { baseUrl, type State, StateStore } from './state.js';
import { executeQuery, stringField, type PreparedRequest, type QueryOptions } from './requests.js';
import { CliError, Exit } from './output.js';
import { prepareLearning } from './catalogue-commands.js';
import { isRawJson } from './json.js';

export const readDefinitions = [
  { id: 'server-version', command: 'server-version', summary: 'Deployed Simphony Enterprise and CC API releases',
    paths: { v1: '/config/sim/v1/getReleaseVersions', v2: '/config/sim/v2/getReleaseVersions' }, scope: 'environment-version' },
  { id: 'hierarchy', command: 'hierarchy list', summary: 'Organization hierarchy trees',
    paths: { v1: '/config/sim/v1/hierarchy/getHierarchy', v2: '/config/sim/v2/hierarchy/getHierarchy' }, scope: 'organization-wide' },
  { id: 'hierarchy-nodes', command: 'hierarchy nodes list', summary: 'Hierarchy nodes (v2 only)',
    paths: { v2: '/config/sim/v2/hierarchy/getHierarchyNodes' }, scope: 'organization-wide' },
  { id: 'menu-item-masters', command: 'menu-item-masters list', summary: 'Menu item masters at one explicit hierarchy unit',
    paths: { v1: '/config/sim/v1/menuItems/getMenuItemMasters', v2: '/config/sim/v2/menuItems/getMenuItemMasters' }, scope: 'hierarchy-unit' },
] as const;
export type ReadId = typeof readDefinitions[number]['id'];
export type ReadOptions = QueryOptions & {
  apiVersion?: 'v1' | 'v2'; organizationWide?: boolean; include?: string; includeAll?: string;
  searchCriteria?: string; languages?: string; langIds?: string; limit?: number; offset?: number; orderBy?: string; hierUnitId?: number;
};
export function integerControl(value: unknown, field: string, minimum = 0): void {
  const numeric = isRawJson(value) ? JSON.parse(JSON.stringify(value)) : value;
  if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new CliError(Exit.usage, `${field} must be a safe integer at least ${minimum}`);
  }
}
function numericFlag(value: string): number {
  if (!/^\d+$/.test(value)) throw new CliError(Exit.usage, 'Expected a nonnegative decimal integer');
  const number = Number(value); integerControl(number, 'Numeric option'); return number;
}
export function buildReadRequest(id: ReadId, state: State, input: Record<string, unknown>, options: ReadOptions): PreparedRequest {
  const definition = readDefinitions.find(item => item.id === id);
  if (!definition) throw new CliError(Exit.usage, 'Unsupported CC read operation');
  const apiVersion = options.apiVersion ?? 'v2';
  if (apiVersion !== 'v1' && apiVersion !== 'v2') throw new CliError(Exit.usage, 'API version must be v1 or v2');
  const route = (definition.paths as Partial<Record<'v1' | 'v2', string>>)[apiVersion];
  if (!route) throw new CliError(Exit.usage, 'This operation has no reviewed route for that API version; no fallback');
  const body = { ...input };
  const controls = ['searchCriteria', 'include', 'includeAll', 'languages', 'langIds', 'limit', 'offset', 'orderBy', 'hierUnitId'] as const;
  for (const key of controls) if (options[key] !== undefined) {
    if (Object.hasOwn(body, key)) throw new CliError(Exit.usage, `Specify ${key} in either JSON or flags, not both`);
    body[key] = options[key];
  }
  if (id === 'server-version') {
    if (Object.keys(body).length) throw new CliError(Exit.usage, 'Server version takes an empty request body');
  } else {
    if (definition.scope === 'organization-wide' && !options.organizationWide) throw new CliError(Exit.usage, 'Hierarchy reads require explicit --organization-wide acknowledgement, even with a filter');
    if (definition.scope === 'hierarchy-unit') {
      if (options.organizationWide) throw new CliError(Exit.usage, 'This task requires an explicit hierarchy unit, not organization-wide scope');
      integerControl(body.hierUnitId, 'hierUnitId', 1);
    }
    const allowed: readonly string[] = controls.filter(key => key !== (apiVersion === 'v1' ? 'langIds' : 'languages') && (key !== 'hierUnitId' || definition.scope === 'hierarchy-unit'));
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new CliError(Exit.usage, 'Unsupported request control for this operation/API version');
    for (const key of ['searchCriteria', 'include', 'languages', 'langIds', 'orderBy']) stringField(body, key, 2000);
    if (body.includeAll !== undefined && !['basic', 'detailed'].includes(body.includeAll as string)) throw new CliError(Exit.usage, 'includeAll must be basic or detailed');
    if (body.offset !== undefined) integerControl(body.offset, 'offset');
    if (body.limit !== undefined) integerControl(body.limit, 'limit', 1);
  }
  if (!state.auth.apiUrl || !state.auth.orgName) throw new CliError(Exit.notConfigured, 'Configure the CC API URL and enterprise shortname first');
  return { method: 'POST', url: baseUrl(state.auth.apiUrl) + route,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body, scope: definition.scope };
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
export function recordOptions(command: Command): Command {
  return readOptions(command)
    .option('--json <object>', 'Explicit JSON request controls; no arbitrary endpoint or write payload')
    .option('--file <path>', 'Read JSON once from file, or - for stdin; exclusive with --json')
    .option('--search-criteria <expression>', 'Forward unchanged; no field-name allowlist or implicit filter')
    .option('--include <fields>', 'Explicit projection, including undocumented field names')
    .addOption(new Option('--include-all <level>', 'Oracle overrides include when supplied').choices(['basic', 'detailed']))
    .option('--languages <codes>', 'v1 only: culture codes, forwarded unchanged')
    .option('--lang-ids <ids>', 'v2 only: language IDs, forwarded unchanged')
    .option('--limit <count>', 'Positive safe integer; one page only, no default injected', numericFlag)
    .option('--offset <index>', 'Nonnegative safe integer; never advanced automatically', numericFlag)
    .option('--order-by <expression>', 'Explicit server ordering; no default injected')
    .addHelpText('after', '\nRead-only POST; run server-version explicitly first to establish the local catalogue.\nExactly one page/request; no pagination, fallback, retries or hierarchy traversal.\nRecord fields are not allowlisted. Request controls and scope are reviewed per task.\nincludeAll overrides include in Oracle. Filter semantics and server page limits remain Oracle-defined.\n');
}
export async function executeRead(id: ReadId, store: StateStore, options: ReadOptions): Promise<number> {
  return executeQuery(id, store, options, (state, input) => buildReadRequest(id, state, input, options), store.directory, undefined,
    async (state, request) => prepareLearning(store.directory, state, id, options.apiVersion ?? 'v2',
      request.body.includeAll ? `includeAll:${request.body.includeAll}` : request.body.include ? `include:${request.body.include}` : 'default'));
}
export function registerReads(root: Command, store: StateStore, setExit: (code: number) => void): void {
  readOptions(root.command('server-version').description('[read-only][network] Deployed Enterprise and CC API versions, not this CLI version'))
    .addHelpText('after', '\nOne POST with an empty JSON body. v2 by default; explicit v1 is supported.\nNo discovery, retries, fallback or configuration changes. Dry-run stays offline.\nSuccessful reads use the shared due-token renewal and verbatim delivery lifecycle.\n')
    .action(async options => { setExit(await executeRead('server-version', store, options)); });
  const masters = root.command('menu-item-masters').description('Read menu item masters; no prices, definitions or writes');
  recordOptions(masters.command('list').description('[read-only][network] One explicit hierarchy-unit page'))
    .option('--hier-unit-id <id>', 'Required hierarchy unit ID (or hierUnitId in JSON); never a structure ID', numericFlag)
    .addHelpText('after', '\nAlthough Oracle marks hierUnitId optional, this CLI requires it explicitly for safe scope.\nA filter alone is not a substitute. No inherited/effective-menu calculation or additional reads.\n')
    .action(async options => { setExit(await executeRead('menu-item-masters', store, options)); });
  const hierarchy = root.command('hierarchy').description('Read hierarchy trees and nodes; never create/delete/move nodes');
  for (const [id, parent] of [['hierarchy', hierarchy], ['hierarchy-nodes', hierarchy.command('nodes').description('Flat hierarchy nodes; reviewed v2 route only')]] as const) {
    recordOptions(parent.command('list').description('[read-only][network] Explicit organization-wide hierarchy read'))
      .option('--organization-wide', 'Required local acknowledgement; never sent to Oracle')
      .action(async options => { setExit(await executeRead(id, store, options)); });
  }
}
