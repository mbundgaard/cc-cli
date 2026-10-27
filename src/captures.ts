import { readFile, open, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseJson, isRawJson } from './json.js';
import { privateSubdirectory, persistPrivateJson as persist } from './private-files.js';
import { RecordHistoryStore, selectObservation, type RecordIdentity, type ObservationSource } from './record-history.js';
import { readOperationById, requireConfigurationOperation } from './configuration-policy.js';
import { type HttpRequest } from './transport.js';
import { CliError, Exit } from './output.js';

export interface CaptureContext {
  company: string; apiUrl: string; task: string; apiVersion: 'v1' | 'v2';
  scopeKind: RecordIdentity['scopeKind']; scopeId: string;
  detail: ObservationSource['detail']; projection?: string; purpose: ObservationSource['purpose'];
  expectedObjectNum?: string; requireRecord?: boolean;
}
export function validateReadCapture(input: Pick<HttpRequest, 'url' | 'method'>, context: CaptureContext): void {
  const operation = requireConfigurationOperation(input, 'read');
  if (!context || `${context.task}:${context.apiVersion}` !== operation.id ||
      context.apiUrl !== new URL(input.url).origin || typeof context.company !== 'string' || !context.company.trim() ||
      typeof context.scopeId !== 'string' || !context.scopeId.trim() ||
      !['environment', 'organization', 'hierarchy-unit', 'location', 'rvc'].includes(context.scopeKind) ||
      !['default', 'detailed', 'projection'].includes(context.detail) ||
      !['read', 'ownership', 'pre-create', 'pre-update', 'pre-delete'].includes(context.purpose)) {
    throw new CliError(Exit.usage, 'Missing or mismatched mandatory read capture context; no request permitted');
  }
}
export interface CaptureReference { captureId: string; manifestPath: string; manifestSha256: string }
export interface CaptureReceipt extends CaptureReference {
  historyStatus: 'complete'; recordCount: number;
}
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && !isRawJson(value); }
function integer(value: unknown): string | undefined {
  const text = isRawJson(value) ? JSON.stringify(value) : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  return /^[1-9][0-9]*$/.test(text) ? text : undefined;
}
// Original bytes already exist privately. Indexing never rewrites this response.
// Every reviewed task uses this pipeline. Task metadata supplies shape/identity,
// never an opt-out. Missing identities or unsupported shapes fail the capture.
export async function captureResponse(directory: string, file: string, context: CaptureContext, proposed?: Record<string, unknown>): Promise<CaptureReceipt> {
  const captureId = randomUUID(), capturedAt = new Date().toISOString();
  const manifestPath = path.join(path.dirname(file), 'manifest.json');
  const operationId = `${context.task}:${context.apiVersion}`;
  const operation = readOperationById(operationId);
  const size = (await lstat(file)).size;
  const manifest: Record<string, unknown> = {schemaVersion: 1, product: 'cc-capture', captureId, capturedAt, context,
    responsePath: file, bytes: size, status: 'indexing', entries: []};
  try {
    if (proposed) manifest.proposedSha256 = await persist(path.join(path.dirname(file), 'proposed.json'), proposed);
    await persist(manifestPath, manifest);
    if (size > 32 * 1024 * 1024) {
      throw new Error('Response exceeds the 32 MiB record-indexing limit');
    }
    const bytes = await readFile(file), responseSha256 = sha(bytes);
    manifest.responseSha256 = responseSha256;
    let body: unknown;
    try { body = parseJson(bytes.toString('utf8')); }
    catch { throw new Error('Response is not valid JSON'); }
    const definition = operation.record;
    const rows = definition.container === 'self' && object(body) ? [body] : object(body) && Array.isArray(body.items) ? body.items : undefined;
    const candidates: {identity: RecordIdentity; record: Record<string, unknown>}[] = [];
    if (rows) {
      const seen = new Set<string>();
      for (const record of rows) {
        if (!object(record)) break;
        const hierarchyId = definition.hierarchyField ? integer(record[definition.hierarchyField]) : undefined;
        const recordId = definition.singletonId ?? (definition.identityField ? integer(record[definition.identityField]) : undefined);
        if (!recordId || (definition.hierarchyField && hierarchyId !== context.scopeId) || seen.has(recordId) ||
            (context.expectedObjectNum !== undefined && context.expectedObjectNum !== recordId)) break;
        seen.add(recordId);
        candidates.push({identity: {company: context.company, apiUrl: context.apiUrl, task: context.task,
          scopeKind: context.scopeKind, scopeId: context.scopeId, recordId}, record});
      }
    }
    const indexable = !!rows && candidates.length === rows.length;
    if (context.requireRecord && (!indexable || candidates.length !== 1 || !object(body) || (body.hasMore !== undefined && body.hasMore !== false) ||
        body.count !== 1 || body.totalResults !== 1 || (body.offset !== undefined && body.offset !== 0))) {
      throw new Error('Exact complete pre-change record could not be captured');
    }
    manifest.page = object(body) ? Object.fromEntries(['hasMore', 'count', 'totalResults', 'offset', 'limit'].filter(k => Object.hasOwn(body, k)).map(k => [k, body[k]])) : {};
    if (!indexable) throw new Error('Missing, foreign or ambiguous record identity; include required identity fields in projections');
    const entries = manifest.entries as unknown[];
    for (const {identity, record} of candidates) {
      const source: ObservationSource = {captureId, capturedAt, operationId, responseSha256, detail: context.detail,
        ...(context.projection !== undefined ? {projection: context.projection} : {}), purpose: context.purpose,
        ...(object(body) && typeof body.hasMore === 'boolean' ? {hasMore: body.hasMore} : {})};
      const saved = await new RecordHistoryStore(directory).append(identity, source, record);
      entries.push({identity, ...saved});
    }
    manifest.status = 'complete';
    return {captureId, manifestPath, manifestSha256: await persist(manifestPath, manifest), historyStatus: 'complete', recordCount: entries.length};
  } catch {
    // Partial history observations may exist. Never claim the page/capture completed.
    manifest.status = 'failed';
    await persist(manifestPath, manifest).catch(() => {});
    throw new CliError(Exit.state, 'CC capture/indexing failed; no completed capture may be claimed and no write is permitted', `Original response retained at ${file}. No automatic retry.`);
  }
}
export async function captureBytes(directory: string, bytes: Buffer, context: CaptureContext, proposed?: Record<string, unknown>): Promise<CaptureReceipt> {
  const folder = await privateSubdirectory(directory, ['responses', `capture-${randomUUID()}`], true);
  const file = path.join(folder, 'response.body'), handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return captureResponse(directory, file, context, proposed);
}
export async function verifyCapture(directory: string, reference: CaptureReference): Promise<void> {
  try {
    if (!reference || !/^[a-f0-9-]{36}$/.test(reference.captureId) || !/^[a-f0-9]{64}$/.test(reference.manifestSha256)) throw new Error();
    const relative = path.relative(path.resolve(directory, 'responses'), reference.manifestPath).split(path.sep);
    if (relative.length !== 2 || !/^(?:response|capture)-[a-zA-Z0-9-]+$/.test(relative[0]!) || relative[1] !== 'manifest.json') throw new Error();
    const folder = await privateSubdirectory(directory, ['responses', relative[0]!]);
    const manifestFile = path.join(folder, 'manifest.json'), responseFile = path.join(folder, 'response.body');
    for (const file of [manifestFile, responseFile]) {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32 * 1024 * 1024) throw new Error();
    }
    const bytes = await readFile(manifestFile);
    if (sha(bytes) !== reference.manifestSha256) throw new Error();
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.product !== 'cc-capture' || manifest.schemaVersion !== 1 || manifest.captureId !== reference.captureId ||
        manifest.status !== 'complete' || sha(await readFile(responseFile)) !== manifest.responseSha256 || !Array.isArray(manifest.entries)) throw new Error();
    if (manifest.proposedSha256 !== undefined) {
      const proposedFile = path.join(folder, 'proposed.json'), stat = await lstat(proposedFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024 ||
          sha(await readFile(proposedFile)) !== manifest.proposedSha256) throw new Error();
    }
    for (const entry of manifest.entries) {
      const observation = selectObservation(await new RecordHistoryStore(directory).load(entry.identity), entry.observationId);
      if (observation.captureId !== reference.captureId || observation.responseSha256 !== manifest.responseSha256) throw new Error();
    }
  } catch { throw new CliError(Exit.state, 'Required saved pre-change evidence is missing, changed or incomplete; no write permitted'); }
}
