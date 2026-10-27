import { Command, Option } from 'commander';
import { baseUrl, companyKey, type State, StateStore } from './state.js';
import { executeQuery, stringField, type PreparedRequest, type QueryOptions } from './requests.js';
import { CliError, Exit } from './output.js';
import { prepareLearning } from './catalogue-commands.js';
import { isRawJson } from './json.js';
import { readDefinitions, type ReadId, type ReadDefinition } from './read-definitions.js';
import { scopedCriteria } from './read-filters.js';
export { readDefinitions, type ReadId } from './read-definitions.js';

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
const commonControls = ['searchCriteria', 'include', 'includeAll', 'languages', 'langIds', 'limit', 'offset', 'orderBy'] as const;
export function buildReadRequest(id: ReadId, state: State, input: Record<string, unknown>, options: ReadOptions): PreparedRequest {
  const definition: ReadDefinition | undefined = readDefinitions.find(item => item.id === id);
  if (!definition) throw new CliError(Exit.usage, 'Unsupported CC read operation');
  const apiVersion = options.apiVersion ?? 'v2';
  if (apiVersion !== 'v1' && apiVersion !== 'v2') throw new CliError(Exit.usage, 'API version must be v1 or v2');
  const route = definition.paths[apiVersion];
  if (!route) throw new CliError(Exit.usage, 'This operation has no reviewed route for that API version; no fallback');
  const body = { ...input };
  const controls = [...commonControls, ...(definition.scopeMode === 'body' ? ['hierUnitId' as const] : [])];
  for (const key of controls) if (options[key] !== undefined) {
    if (Object.hasOwn(body, key)) throw new CliError(Exit.usage, `Specify ${key} in either JSON or flags, not both`);
    body[key] = options[key];
  }
  if (definition.scopeMode === 'none') {
    if (Object.keys(body).length || options.hierUnitId !== undefined || options.organizationWide) throw new CliError(Exit.usage, 'Server version takes an empty request body and no record scope');
  } else {
    if (definition.scopeMode === 'acknowledgement') {
      if (!options.organizationWide) throw new CliError(Exit.usage, 'Hierarchy reads require explicit --organization-wide acknowledgement, even with a filter');
      if (options.hierUnitId !== undefined) throw new CliError(Exit.usage, 'This task does not accept a hierarchy-unit scope flag');
    } else {
      if (options.organizationWide) throw new CliError(Exit.usage, 'This task requires an explicit hierarchy unit, not organization-wide scope');
      integerControl(definition.scopeMode === 'body' ? body.hierUnitId : options.hierUnitId, 'hierUnitId', 1);
    }
    const allowed: readonly string[] = controls.filter(key => key !== (apiVersion === 'v1' ? 'langIds' : 'languages'));
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new CliError(Exit.usage, 'Unsupported request control for this operation/API version');
    for (const key of ['searchCriteria', 'include', 'languages', 'langIds', 'orderBy']) stringField(body, key, 2000);
    if (body.includeAll !== undefined && !['basic', 'detailed'].includes(body.includeAll as string)) throw new CliError(Exit.usage, 'includeAll must be basic or detailed');
    if (body.offset !== undefined) integerControl(body.offset, 'offset');
    if (body.limit !== undefined) integerControl(body.limit, 'limit', 1);
    if (definition.scopeMode === 'criteria') body.searchCriteria = scopedCriteria(options.hierUnitId!, body.searchCriteria as string | undefined);
  }
  if (!state.auth.apiUrl || !state.auth.orgName) throw new CliError(Exit.notConfigured, 'Configure the CC API URL and enterprise shortname first');
  return { method: 'POST', url: baseUrl(state.auth.apiUrl) + route,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body, scope: definition.scope,
    capture: {company: state.auth.authUrl ? companyKey(state.auth) : '', apiUrl: baseUrl(state.auth.apiUrl), task: id, apiVersion,
      scopeKind: definition.scopeMode === 'none' ? 'environment' : definition.scopeMode === 'acknowledgement' ? 'organization' :
        definition.scope === 'location' ? 'location' : definition.scope === 'revenue-center' ? 'rvc' : 'hierarchy-unit',
      scopeId: definition.scopeMode === 'none' || definition.scopeMode === 'acknowledgement' ? 'all' :
        String(definition.scopeMode === 'body' ? JSON.parse(JSON.stringify(body.hierUnitId)) : options.hierUnitId),
      detail: body.includeAll === 'detailed' ? 'detailed' : !body.includeAll && body.include ? 'projection' : 'default',
      ...(!body.includeAll && body.include ? {projection: body.include as string} : {}), purpose: 'read'}};
}
export function readOptions(command: Command): Command {
  return command.addOption(new Option('--api-version <version>', 'Explicit contract; no automatic fallback').choices(['v1', 'v2']).default('v2'))
    .option('--dry-run', 'Show the exact request without tokens, network or state changes')
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
    .option('--search-criteria <expression>', 'Server-side filter; scoped-filter tasks AND it with the explicit hierarchy scope')
    .option('--include <fields>', 'Server-side projection, including undocumented field names')
    .addOption(new Option('--include-all <level>', 'Oracle overrides include when supplied').choices(['basic', 'detailed']))
    .option('--languages <codes>', 'v1 only: culture codes, forwarded unchanged')
    .option('--lang-ids <ids>', 'v2 only: language IDs, forwarded unchanged')
    .option('--limit <count>', 'Positive safe integer; one page only, no default injected', numericFlag)
    .option('--offset <index>', 'Nonnegative safe integer; never advanced automatically', numericFlag)
    .option('--order-by <expression>', 'Server-side ordering, e.g. objectNum:asc; no client sorting or default')
    .addHelpText('after', '\nRead-only POST; responses are saved privately and stdout contains a file receipt.\nEvery supported task uses mandatory record-history capture.\nMissing/ambiguous identity fields or indexing failure retain raw evidence but fail the read capture.\nRun server-version explicitly first to establish the local catalogue.\nExactly one page/request; no automatic pagination, fallback, retries or hierarchy traversal.\nRecord fields are not allowlisted. Request controls and scope are reviewed per task.\nincludeAll overrides include in Oracle. Filter semantics and server page limits remain Oracle-defined.\n');
}
export async function executeRead(id: ReadId, store: StateStore, options: ReadOptions): Promise<number> {
  return executeQuery(id, store, options, (state, input) => buildReadRequest(id, state, input, options), store.directory, undefined,
    async (state, request) => prepareLearning(store.directory, state, id, options.apiVersion ?? 'v2',
      request.body.includeAll ? `includeAll:${request.body.includeAll}` : request.body.include ? `include:${request.body.include}` : 'default'));
}
export function registerReads(root: Command, store: StateStore, setExit: (code: number) => void): void {
  // Only this compiled registry creates commands, never imported Swagger or observed fields.
  for (const definition of readDefinitions) {
    const names = definition.command.split(' ');
    let parent = root;
    for (const name of names.slice(0, -1)) {
      parent = parent.commands.find(command => command.name() === name) ?? parent.command(name).description('Explicit CC read-only tasks; no related-object discovery or writes');
    }
    const leaf = parent.command(names.at(-1)!).description(`[read-only][network] ${definition.summary}`);
    const command = definition.scopeMode === 'none' ? readOptions(leaf) : recordOptions(leaf);
    command.addHelpText('after', `\n${definition.help}\n`);
    if (definition.scopeMode === 'acknowledgement') command.option('--organization-wide', 'Required local acknowledgement; never sent to Oracle');
    if (definition.scopeMode === 'body' || definition.scopeMode === 'criteria') command.option('--hier-unit-id <id>', `Required: ${definition.scopeLabel}`, numericFlag);
    if (definition.scopeMode === 'criteria') command.addHelpText('after', '\nScope flag is local, not a top-level JSON field: where equals(hierUnitId,ID).\nAdditional searchCriteria is AND-grouped within that scope; optional leading where is stripped.\nExpressions allow functions, grouped AND/OR/!, single-quoted strings and scalar arguments.\nComments/backslash escapes are rejected locally; dry-run shows the exact combined expression.\n');
    command.action(async options => { setExit(await executeRead(definition.id, store, options)); });
  }
}
