import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import parser, { type Token } from 'stream-json/parser.js';
import { baseUrl, companyKey, type State } from './state.js';
import { CliError, Exit } from './output.js';
import type { Delivery } from './responses.js';

export type Fields = Record<string, string[]>;
export interface Target { company: string; apiUrl: string; accountHash: string }
export interface Versions { enterprise: string; api: string }
export interface Documented { request: Fields; response: Fields }
export interface Source { sha256: string; version: string; importedAt: string; contracts: Record<string, Documented> }
interface Observed { fields: Fields; firstSeen: string; lastSeen: string; samples: number; projections: string[]; documentHashes: string[] }
export interface Generation { id: string; versions: Versions; detectedAt: string; checkedAt: string; observations: Record<string, Observed> }
interface Environment { target: Target; current: Generation; archives: Generation[] }
interface Catalogue { schemaVersion: 1; product: 'cc-catalogue'; activeDocument?: string; documents: Record<string, Source>; environments: Record<string, Environment> }
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const empty = (): Catalogue => ({ schemaVersion: 1, product: 'cc-catalogue', documents: {}, environments: {} });
const MAX_FILE = 64 * 1024 * 1024;
export function targetFor(state: State): Target {
  if (!state.auth.apiUrl) throw new CliError(Exit.notConfigured, 'Configure a CC API URL first');
  return { company: companyKey(state.auth), apiUrl: baseUrl(state.auth.apiUrl), accountHash: hash(state.auth.username ?? '') };
}
const targetKey = (target: Target) => hash(JSON.stringify(target));
export const contractKey = (operation: string, version: string) => `${operation}:${version}`;
const pointer = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');
function add(fields: Fields, field: string, type: string): void {
  if (!Object.hasOwn(fields, field)) fields[field] = [];
  if (!fields[field]!.includes(type)) fields[field]!.push(type);
  fields[field]!.sort();
}
export function releaseVersions(value: unknown): Versions {
  const body = value as Record<string, unknown> | null;
  const valid = (item: unknown): item is string => typeof item === 'string' && item.length > 0 && item.length <= 128 && /^[A-Za-z0-9._+-]+$/.test(item);
  if (!body || !valid(body.simphonyEnterpriseVersion) || !valid(body['C&CVersion'])) throw new Error('Version response cannot establish a catalogue generation');
  return { enterprise: body.simphonyEnterpriseVersion, api: body['C&CVersion'] };
}

// Schema references never cause network access. Only local Swagger 2 references are resolved.
export function documentedFields(schema: unknown, document: Record<string, any>): Fields {
  const fields: Fields = {};
  function visit(node: any, field: string, refs: Set<string>, depth: number): void {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (depth > 64 || Object.keys(fields).length > 10000) throw new Error('Schema complexity limit exceeded');
    if (node.$ref !== undefined) {
      if (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/')) throw new Error('Only local schema references are supported');
      if (refs.has(node.$ref)) { add(fields, field, 'recursive'); return; }
      let next: any = document;
      for (const segment of node.$ref.slice(2).split('/')) {
        const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
        if (!next || !Object.hasOwn(next, key)) throw new Error('Unresolved local schema reference');
        next = next[key];
      }
      visit(next, field, new Set([...refs, node.$ref]), depth + 1); return;
    }
    for (const composition of ['allOf', 'oneOf', 'anyOf']) {
      if (Array.isArray(node[composition])) for (const child of node[composition]) visit(child, field, refs, depth + 1);
    }
    const composed = ['allOf', 'oneOf', 'anyOf'].some(key => Array.isArray(node[key]));
    const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : node.properties ? ['object'] : node.items ? ['array'] : composed ? [] : ['unknown'];
    for (const type of types) if (typeof type === 'string') add(fields, field, type);
    if (node.nullable === true || node['x-nullable'] === true) add(fields, field, 'null');
    if (node.properties && typeof node.properties === 'object') for (const [key, child] of Object.entries(node.properties)) visit(child, `${field}/${pointer(key)}`, refs, depth + 1);
    if (node.items) visit(node.items, `${field}/*`, refs, depth + 1);
    if (node.additionalProperties && typeof node.additionalProperties === 'object') visit(node.additionalProperties, `${field}/*`, refs, depth + 1);
    else if (types.includes('object') && (!node.properties || node.additionalProperties === true)) add(fields, `${field}/*`, 'unknown');
  }
  visit(schema, '', new Set(), 0);
  return fields;
}
export async function importSpecification(file: string, definitions: readonly { id: string; paths: { v1: string; v2: string } }[]): Promise<Source> {
  if ((await stat(file)).size > MAX_FILE) throw new Error('Specification exceeds 64 MiB');
  const bytes = await readFile(file);
  const document = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (document?.swagger !== '2.0' || !document.paths || typeof document.info?.version !== 'string') throw new Error('Expected a Swagger 2 specification with a version');
  const contracts: Record<string, Documented> = {};
  for (const definition of definitions) for (const version of ['v1', 'v2'] as const) {
    const operation = document.paths[definition.paths[version]]?.post;
    if (!operation) continue;
    const request: Fields = {};
    for (let parameter of operation.parameters ?? []) {
      if (parameter.$ref) {
        if (!parameter.$ref.startsWith('#/parameters/')) throw new Error('Unsupported parameter reference');
        parameter = document.parameters?.[parameter.$ref.slice('#/parameters/'.length)];
        if (!parameter) throw new Error('Unresolved parameter reference');
      }
      if (parameter.in === 'body') Object.assign(request, documentedFields(parameter.schema, document));
    }
    contracts[contractKey(definition.id, version)] = { request, response: documentedFields(operation.responses?.['200']?.schema, document) };
  }
  if (!Object.keys(contracts).length) throw new Error('Specification has no implemented CC contracts');
  return { sha256: hash(bytes), version: document.info.version, importedAt: new Date().toISOString(), contracts };
}

// Streaming structural observation. Primitive values are discarded, never assembled or saved.
// Keys are bounded, array indexes normalized, and documented maps use wildcard keys.
export async function observeFields(delivery: Delivery, documented: Fields = {}): Promise<Fields> {
  const fields: Fields = {};
  const frames: { path: string; type: string; key?: string }[] = [];
  let key: string | undefined, fieldCount = 0;
  const sink = new Writable({ objectMode: true, write(token: Token, _encoding, done) {
    try {
      if (token.name === 'startKey') { key = ''; done(); return; }
      if (token.name === 'stringChunk' && key !== undefined) {
        key += token.value;
        if (key.length > 256) throw new Error('Field name exceeds observation limit');
        done(); return;
      }
      if (token.name === 'endKey') { frames.at(-1)!.key = key; key = undefined; done(); return; }
      if (token.name === 'endObject' || token.name === 'endArray') { frames.pop(); done(); return; }
      const types: Record<string, string> = { startObject: 'object', startArray: 'array', startString: 'string', startNumber: 'number', trueValue: 'boolean', falseValue: 'boolean', nullValue: 'null' };
      const type = types[token.name];
      if (type) {
        const parent = frames.at(-1);
        const map = parent && Object.hasOwn(documented, `${parent.path}/*`) && parent.type === 'object';
        const field = !parent ? '' : `${parent.path}/${parent.type === 'array' || map || /^\d+$/.test(parent.key ?? '') ? '*' : pointer(parent.key ?? '')}`;
        if (!Object.hasOwn(fields, field)) fieldCount++;
        if (fieldCount > 10000 || ((type === 'object' || type === 'array') && frames.length >= 64)) throw new Error('Observation complexity limit exceeded');
        add(fields, field, type);
        if (type === 'object' || type === 'array') frames.push({ path: field, type });
      }
      done();
    } catch { done(new Error('Cannot collect field metadata safely')); }
  } });
  const source = delivery.kind === 'inline' ? Readable.from([delivery.body.toString('utf8')]) : createReadStream(delivery.path, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  await pipeline(source, parser.asStream({ packValues: false, streamValues: true, jsonStreaming: false }), sink);
  return fields;
}
export function compareFields(documented: Fields, observed: Fields) {
  const observedOnly: string[] = [], typeDifferences: { path: string; documented: string[]; observed: string[] }[] = [];
  const expectedFor = (field: string) => documented[field] ?? Object.entries(documented).find(([pattern]) => {
    const parts = pattern.split('/'), actual = field.split('/');
    return parts.length === actual.length && parts.every((part, index) => part === '*' || part === actual[index]);
  })?.[1];
  for (const [field, types] of Object.entries(observed)) {
    const expected = expectedFor(field);
    if (!expected) observedOnly.push(field);
    else if (!expected.some(type => ['unknown', 'recursive'].includes(type)) && types.some(type => type !== 'null' && !expected.map(item => item === 'integer' ? 'number' : item).includes(type))) {
      typeDifferences.push({ path: field, documented: expected, observed: types });
    }
  }
  return { observedOnly, typeDifferences, documentedNotYetObserved: Object.keys(documented).filter(field => !Object.hasOwn(observed, field)),
    caveat: 'Not observed does not mean missing. Null alone establishes no type. Integer constraints and writability are not inferred.' };
}

export class CatalogueStore {
  readonly file: string;
  constructor(readonly directory: string) { this.file = path.join(directory, 'catalogue.json'); }
  async load(): Promise<Catalogue> {
    try {
      if ((await stat(this.file)).size > MAX_FILE) throw new Error('Catalogue exceeds storage limit');
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (value?.schemaVersion !== 1 || value.product !== 'cc-catalogue' || !value.documents || !value.environments) throw new Error('Invalid catalogue');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
      throw new CliError(Exit.state, 'Cannot read CC field catalogue; existing file has not been replaced');
    }
  }
  private async mutate(run: (value: Catalogue) => void): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockFile = `${this.file}.lock`, temp = `${this.file}.${randomUUID()}.tmp`;
    let lock;
    try { lock = await open(lockFile, 'wx', 0o600); }
    catch { throw new CliError(Exit.state, 'CC catalogue is locked; inspect before removing any stale lock'); }
    try {
      const value = await this.load(); run(value);
      const text = JSON.stringify(value, null, 2) + '\n';
      if (Buffer.byteLength(text) > MAX_FILE) throw new Error('Catalogue exceeds storage limit');
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, this.file);
    } finally { await unlink(temp).catch(() => {}); await lock.close(); await unlink(lockFile); }
  }
  async import(source: Source): Promise<void> {
    await this.mutate(value => { value.documents[source.sha256] = source; value.activeDocument = source.sha256; });
  }
  async detect(target: Target, versions: Versions): Promise<void> {
    await this.mutate(value => {
      const id = targetKey(target), now = new Date().toISOString(), previous = value.environments[id];
      if (previous && previous.current.versions.enterprise === versions.enterprise && previous.current.versions.api === versions.api) { previous.current.checkedAt = now; return; }
      value.environments[id] = { target, current: { id: randomUUID(), versions, detectedAt: now, checkedAt: now, observations: {} },
        archives: previous ? [...previous.archives, previous.current] : [] };
    });
  }
  async view(target?: Target) {
    const value = await this.load();
    return { document: value.activeDocument ? value.documents[value.activeDocument] : undefined,
      environment: target ? value.environments[targetKey(target)] : undefined };
  }
  async observe(target: Target, generationId: string, contract: string, fields: Fields, projection: string, documentHash?: string): Promise<void> {
    await this.mutate(value => {
      const generation = value.environments[targetKey(target)]?.current;
      if (!generation || generation.id !== generationId) throw new Error('Version generation changed during the read; observation not saved');
      const now = new Date().toISOString(), old = generation.observations[contract];
      const merged: Fields = old?.fields ?? {};
      for (const [field, types] of Object.entries(fields)) for (const type of types) add(merged, field, type);
      if (Object.keys(merged).length > 10000) throw new Error('Catalogue field limit exceeded');
      generation.observations[contract] = { fields: merged, firstSeen: old?.firstSeen ?? now, lastSeen: now, samples: (old?.samples ?? 0) + 1,
        projections: [...new Set([...(old?.projections ?? []), projection])].slice(-100),
        documentHashes: [...new Set([...(old?.documentHashes ?? []), ...(documentHash ? [documentHash] : [])])] };
    });
  }
}
