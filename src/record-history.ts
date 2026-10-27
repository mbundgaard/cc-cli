import { lstat, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateSubdirectory } from './private-files.js';
import { canonical, digest, withFileLock } from './write-scope.js';
import { parseJson, isRawJson } from './json.js';
import { readOperations } from './configuration-policy.js';
import { validateUrl } from './transport.js';
import { CliError, Exit } from './output.js';

const MAX_BYTES = 64 * 1024 * 1024;
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface RecordScope {
  company: string; apiUrl: string; task: string;
  scopeKind: 'environment' | 'organization' | 'hierarchy-unit' | 'location' | 'rvc'; scopeId: string;
}
export interface RecordIdentity extends RecordScope { recordId: string }
export interface ObservationSource {
  captureId: string; capturedAt: string; operationId: string; responseSha256: string;
  detail: 'default' | 'detailed' | 'projection'; projection?: string; hasMore?: boolean;
  purpose: 'read' | 'ownership' | 'pre-create' | 'pre-update' | 'pre-delete';
}
export interface RecordObservation extends ObservationSource {
  observationId: string; recordSha256: string; record: Record<string, unknown>;
}
export interface RecordHistory {
  schemaVersion: 1; product: 'cc-record-history'; identity: RecordIdentity;
  latestObservationId: string; observations: RecordObservation[];
}
function invalid(): never { throw new CliError(Exit.state, 'Invalid, unsafe or oversized CC record history; no history was changed'); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && !isRawJson(value); }
function exactKeys(value: object, allowed: string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
const scopeFields = ['company', 'apiUrl', 'task', 'scopeKind', 'scopeId'];
function text(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }
function validateScope(value: RecordScope, record = false): void {
  if (!object(value)) invalid();
  exactKeys(value, record ? [...scopeFields, 'recordId'] : scopeFields);
  if (!text(value.company) || !text(value.apiUrl) || !text(value.task) || !text(value.scopeId) ||
      !['environment', 'organization', 'hierarchy-unit', 'location', 'rvc'].includes(value.scopeKind)) invalid();
  const url = validateUrl(value.apiUrl);
  if (value.apiUrl !== url.origin) invalid();
  if (!readOperations.some(op => op.task === value.task)) invalid();
  if (record && !text(value.recordId)) invalid();
}
function validateSource(source: ObservationSource, identity: RecordIdentity): void {
  if (!object(source) || typeof source.captureId !== 'string' || !uuid.test(source.captureId) ||
      typeof source.responseSha256 !== 'string' || !hash.test(source.responseSha256) ||
      typeof source.capturedAt !== 'string' || !Number.isFinite(Date.parse(source.capturedAt)) ||
      new Date(source.capturedAt).toISOString() !== source.capturedAt ||
      !['default', 'detailed', 'projection'].includes(source.detail) || !['read', 'ownership', 'pre-create', 'pre-update', 'pre-delete'].includes(source.purpose) ||
      (source.hasMore !== undefined && typeof source.hasMore !== 'boolean') ||
      (source.projection !== undefined && (typeof source.projection !== 'string' || !source.projection.trim() || source.projection.length > 2000)) ||
      (source.detail === 'projection' && source.projection === undefined)) invalid();
  if (!readOperations.some(op => op.id === source.operationId && op.task === identity.task)) invalid();
}
const sourceFields = ['captureId', 'capturedAt', 'operationId', 'responseSha256', 'detail', 'projection', 'hasMore', 'purpose'];
function validateHistory(value: unknown, expected?: RecordIdentity): RecordHistory {
  if (!object(value)) invalid();
  exactKeys(value, ['schemaVersion', 'product', 'identity', 'latestObservationId', 'observations']);
  if (value.schemaVersion !== 1 || value.product !== 'cc-record-history') invalid();
  const identity = value.identity as RecordIdentity;
  validateScope(identity, true);
  if (expected && canonical(expected) !== canonical(identity)) invalid();
  if (!Array.isArray(value.observations) || !value.observations.length) invalid();
  const seen = new Set<string>();
  for (const raw of value.observations) {
    if (!object(raw)) invalid();
    exactKeys(raw, [...sourceFields, 'observationId', 'recordSha256', 'record']);
    const observation = raw as unknown as RecordObservation;
    validateSource(observation, identity);
    if (!uuid.test(observation.observationId) || seen.has(observation.observationId) || !object(observation.record) ||
        observation.recordSha256 !== digest(observation.record)) invalid();
    seen.add(observation.observationId);
  }
  if (value.latestObservationId !== latestObservation(value.observations as RecordObservation[]).observationId) invalid();
  return value as unknown as RecordHistory;
}
function latestObservation(observations: RecordObservation[]): RecordObservation {
  return observations.reduce((latest, item) => Date.parse(item.capturedAt) >= Date.parse(latest.capturedAt) ? item : latest);
}
export function observationSummary(observation: RecordObservation) {
  const {record: _record, ...metadata} = observation;
  return metadata;
}
export function selectObservation(history: RecordHistory, version = 'latest'): RecordObservation {
  const id = version === 'latest' ? history.latestObservationId : version;
  const result = history.observations.find(item => item.observationId === id);
  if (!result) throw new CliError(Exit.usage, 'Saved observation not found; no Oracle request made');
  return result;
}
export interface RecordChange { pointer: string; beforePresent: boolean; afterPresent: boolean; before?: unknown; after?: unknown }
// Arrays are compared as complete values, never guessed child-row identities.
export function diffRecords(before: Record<string, unknown>, after: Record<string, unknown>): RecordChange[] {
  const result: RecordChange[] = [];
  function walk(a: unknown, b: unknown, pointer: string, aPresent = true, bPresent = true): void {
    if (aPresent && bPresent && canonical(a) === canonical(b)) return;
    if (aPresent && bPresent && object(a) && object(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        walk(a[key], b[key], `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, Object.hasOwn(a, key), Object.hasOwn(b, key));
      }
    } else result.push({pointer, beforePresent: aPresent, afterPresent: bPresent, ...(aPresent ? {before: a} : {}), ...(bPresent ? {after: b} : {})});
  }
  walk(before, after, ''); return result;
}
export class RecordHistoryStore {
  constructor(readonly directory: string) {}
  private async folder(scope: RecordScope, create: boolean): Promise<string> {
    const {company, apiUrl, task, scopeKind, scopeId} = scope;
    validateScope({company, apiUrl, task, scopeKind, scopeId});
    return privateSubdirectory(this.directory, ['records', digest({company, apiUrl}), `${scopeKind}-${digest(scopeId)}`, task], create);
  }
  private async read(file: string, identity?: RecordIdentity): Promise<RecordHistory> {
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) invalid();
      const input = await readFile(file, 'utf8');
      if (Buffer.byteLength(input) > MAX_BYTES) invalid();
      return validateHistory(parseJson(input), identity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
      return invalid(); // Never expose parse-error excerpts containing customer values.
    }
  }
  async load(identity: RecordIdentity): Promise<RecordHistory> {
    try {
      validateScope(identity, true);
      return await this.read(path.join(await this.folder(identity, false), `${digest(identity.recordId)}.json`), identity);
    } catch { throw new CliError(Exit.state, 'Cannot read saved CC record history; missing, invalid or unsafe local file. No Oracle request made'); }
  }
  // Internal ingestion API, not a user-supplied arbitrary file/record import command.
  async append(identity: RecordIdentity, source: ObservationSource, record: Record<string, unknown>): Promise<{path: string; observationId: string}> {
    try {
      validateScope(identity, true); validateSource(source, identity); exactKeys(source, sourceFields);
      if (!object(record)) invalid();
      // Snapshot arguments before asynchronous operations; preserve raw numeric values.
      const frozen = parseJson(JSON.stringify({identity, source, record})) as {identity: RecordIdentity; source: ObservationSource; record: Record<string, unknown>};
      const folder = await this.folder(frozen.identity, true), file = path.join(folder, `${digest(frozen.identity.recordId)}.json`);
      return await withFileLock(`${file}.lock`, async () => {
        let history: RecordHistory;
        try { history = await this.read(file, frozen.identity); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          history = {schemaVersion: 1, product: 'cc-record-history', identity: frozen.identity, latestObservationId: '', observations: []};
        }
        const observationId = randomUUID();
        history.observations.push({...frozen.source, observationId, recordSha256: digest(frozen.record), record: frozen.record});
        history.latestObservationId = latestObservation(history.observations).observationId;
        const output = JSON.stringify(history, null, 2) + '\n';
        if (Buffer.byteLength(output) > MAX_BYTES) invalid(); // Never trim old values to fit.
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temp, 'wx', 0o600);
          try { await handle.writeFile(output); await handle.sync(); } finally { await handle.close(); }
          await rename(temp, file);
        } finally { await unlink(temp).catch(() => {}); }
        return {path: file, observationId};
      });
    } catch { throw new CliError(Exit.state, 'Cannot save CC record history; no successful capture may be claimed. Inspect storage/locks before continuing'); }
  }
  async list(scope: RecordScope, offset = 0, limit = 50) {
    validateScope(scope);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CliError(Exit.usage, 'Local offset must be nonnegative; limit must be 1–100');
    let folder: string;
    try { folder = await this.folder(scope, false); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {items: [], nextOffset: null}; throw new CliError(Exit.state, 'Cannot inspect local record directory'); }
    const files = (await readdir(folder)).filter(file => /^[a-f0-9]{64}\.json$/.test(file)).sort();
    const items = [];
    for (const name of files.slice(offset, offset + limit)) {
      const history = await this.read(path.join(folder, name));
      if (name !== `${digest(history.identity.recordId)}.json` || canonical(scope) !== canonical(Object.fromEntries(scopeFields.map(key => [key, history.identity[key as keyof RecordScope]])))) invalid();
      items.push({identity: history.identity, path: path.join(folder, name), observations: history.observations.length,
        latest: observationSummary(selectObservation(history))});
    }
    return {items, nextOffset: offset + limit < files.length ? offset + limit : null};
  }
}
