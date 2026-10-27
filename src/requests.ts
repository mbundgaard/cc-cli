import { readFile } from 'node:fs/promises';
import { requireConfigurationOperation } from './configuration-policy.js';
import { validateReadCapture, type CaptureContext } from './captures.js';
import { CliError, Exit, localResult } from './output.js';
import { baseUrl, bearerToken, stateDirectory, StateStore, activeState, type State } from './state.js';
import { type DeliveryObserver } from './responses.js';
import { exchangeConfiguration, publishConfiguration } from './configuration-exchange.js';
import { refreshCompanies } from './companies.js';
import { notifyForUpdates } from './updates.js';
import { readFileSync } from 'node:fs';
const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
import { parseJson, isRawJson } from './json.js';
export interface QueryOptions {
  json?: string; file?: string; dryRun?: boolean; quiet?: boolean; timeout?: number;
}
export async function inputBody(options: QueryOptions): Promise<Record<string, unknown>> {
  if (options.json !== undefined && options.file !== undefined) throw new CliError(Exit.usage, 'Use either --json or --file, not both');
  let text = options.json;
  if (options.file !== undefined) {
    try {
      if (options.file === '-') {
        const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        text = Buffer.concat(chunks).toString('utf8');
      } else text = await readFile(options.file, 'utf8');
    } catch { throw new CliError(Exit.usage, 'Cannot read request body file/stdin'); }
  }
  if (text === undefined) return {};
  let body: unknown;
  try { body = parseJson(text.replace(/^\uFEFF/, '')); }
  catch { throw new CliError(Exit.usage, 'Request body is not valid JSON; contents withheld'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || isRawJson(body)) throw new CliError(Exit.usage, 'Request body must be a JSON object');
  return body as Record<string, unknown>;
}
export function stringField(body: Record<string, unknown>, key: string, maximum?: number): void {
  const value = body[key];
  if (value === undefined) return;
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value) || (maximum !== undefined && value.length > maximum)) {
    throw new CliError(Exit.usage, `${key} must be a nonblank string without control characters${maximum ? ` (maximum ${maximum} characters)` : ''}`);
  }
}
export function dateField(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new CliError(Exit.usage, `${field} must be an actual calendar date in YYYY-MM-DD format`);
  }
}
export interface PreparedRequest {
  method: string; url: string; headers: Record<string, string>;
  body: Record<string, unknown>; scope: string; capture: CaptureContext;
}
// Shared execution for every implemented data area: one input read, pinned company,
// preflight validation, renewal, unchanged delivery and advisory update notices.
export async function prepareQuery(source: State | StateStore, options: QueryOptions,
  build: (state: State, input: Record<string, unknown>) => PreparedRequest) {
  const store = source instanceof StateStore ? source : undefined;
  const registry = store ? await store.loadCompanies() : undefined;
  const selected = registry?.activeCompany;
  let state: State = registry ? selected ? activeState(registry) : options.dryRun && registry.pending ? registry.pending : activeState(registry) : source as State;
  const input = await inputBody(options); // Read stdin/file exactly once, before any renewal.
  let built = build(state, input);
  requireConfigurationOperation(built, 'read');
  if (!built.capture) throw new CliError(Exit.usage, 'Read capture metadata is mandatory; no request permitted');
  if (options.dryRun) {
    localResult('dry-run', { ...built, readOnly: true, authorizationOmitted: true });
    return undefined;
  }
  validateReadCapture(built, built.capture);
  if (store) {
    await refreshCompanies(store, true, options.timeout, options.quiet);
    const latest = await store.loadCompanies(), profile = selected ? latest.companies[selected] : undefined;
    if (!profile) throw new CliError(Exit.notConfigured, 'Selected CC company was removed; no data request was sent');
    state = profile;
    built = build(state, input);
    requireConfigurationOperation(built, 'read');
  }
  if (!built.capture || !built.capture.company) throw new CliError(Exit.notConfigured, 'Configure the CC company before saving network captures');
  validateReadCapture(built, built.capture);
  const token = bearerToken(state); // CC id_token, never access_token.
  return {store, state, built, token};
}
export async function executeQuery(operation: string, source: State | StateStore, options: QueryOptions,
  build: (state: State, input: Record<string, unknown>) => PreparedRequest,
  responseDirectory = source instanceof StateStore ? source.directory : stateDirectory(), notifyUpdate = notifyForUpdates,
  prepareObserver?: (state: State, request: PreparedRequest) => Promise<DeliveryObserver>): Promise<number> {
  const prepared = await prepareQuery(source, options, build);
  if (!prepared) return Exit.ok;
  const {store, state, built, token} = prepared;
  const observer = prepareObserver ? await prepareObserver(state, built) : undefined;
  const result = await exchangeConfiguration({ ...built, headers: { ...built.headers, Authorization: `Bearer ${token}` },
    body: JSON.stringify(built.body), timeoutMs: (options.timeout ?? 30) * 1000 }, responseDirectory, {kind: 'read', capture: built.capture});
  const code = await publishConfiguration(result, operation, options.quiet, observer);
  if (store && code === Exit.ok && !options.quiet) {
    try { await notifyUpdate(store.directory, version); } catch { /* Advisory only. */ }
  }
  return code;
}
