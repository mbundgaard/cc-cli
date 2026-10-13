import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { StateStore, activeState, bearerToken } from './state.js';
import { refreshCompanies } from './companies.js';
import { inputBody, type QueryOptions } from './requests.js';
import { requestInto, httpExit, type HttpRequest } from './transport.js';
import { deliverResponse } from './responses.js';
import { CliError, Exit, localResult } from './output.js';
import { parseJson, isRawJson } from './json.js';
import { WriteScopeStore, withFileLock, writeIdentity, digest, positiveId, type WriteScope, type WriteApproval } from './write-scope.js';

export const writeRisks = [
  'Omitted optional fields may be cleared; this is not PATCH or an automatic read/merge/write.',
  'Documentation and observed reads do not prove completeness or writability. Explicit null may clear or be rejected.',
  'Ownership/existence and approval freshness checks are not atomic with the write. No documented conditional-write guarantee.',
  'One top-level record only; nested settings may affect child rows. No automatic snapshot, readback, retry, or rollback.',
];
export interface GuardedWriteOptions extends QueryOptions {
  hierUnitId: number; objectNum: number; auditRef: string; prepare?: boolean; execute?: boolean;
  approve?: string; ackUpdateRisks?: boolean; allowUnverifiedFields?: boolean; confirmDelete?: number;
}
export interface GuardedWriteDefinition {
  command: string; action: 'create' | 'update' | 'delete'; path: string; readPath: string;
  scope: 'location' | 'rvc'; namespace: 'order-device' | 'kds-display'; risks: readonly string[];
  validate: (body: Record<string, unknown>, options: GuardedWriteOptions, scope: WriteScope) => string[];
}
export const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && !isRawJson(value); }
export function validateWriteControls(body: Record<string, unknown>, options: GuardedWriteOptions): void {
  positiveId(options.hierUnitId, '--hier-unit-id'); positiveId(options.objectNum, '--object-num');
  if (body.hierUnitId !== options.hierUnitId || body.objectNum !== options.objectNum) throw new CliError(Exit.usage, 'Payload hierUnitId/objectNum must exactly match the explicit target flags');
  if (typeof options.auditRef !== 'string' || !options.auditRef.trim() || options.auditRef.length > 2000 || /[\u0000-\u001f\u007f-\uffff]/.test(options.auditRef)) throw new CliError(Exit.usage, '--audit-ref must be nonblank printable ASCII, at most 2000 characters');
  if (!Number.isFinite(options.timeout ?? 30) || (options.timeout ?? 30) <= 0 || (options.timeout ?? 30) > 300) throw new CliError(Exit.usage, 'Timeout must be positive and at most 300 seconds');
  if ([options.dryRun, options.prepare, options.execute].filter(Boolean).length > 1) throw new CliError(Exit.usage, 'Choose only one of --dry-run, --prepare, --execute');
  if ((options.approve || options.ackUpdateRisks) && !options.execute) throw new CliError(Exit.usage, '--approve and --ack-update-risks require --execute');
  if (options.execute && (!options.ackUpdateRisks || !/^[a-f0-9]{64}$/.test(options.approve ?? ''))) throw new CliError(Exit.usage, '--execute requires --approve <one-use-id> and --ack-update-risks');
  if (Buffer.byteLength(JSON.stringify(body)) > 1024 * 1024) throw new CliError(Exit.usage, 'Write body exceeds the 1 MiB limit');
}
async function proof(input: HttpRequest): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let bytes = 0;
  const sink = new Writable({write(chunk, _encoding, done) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) done(new Error('Ownership response too large')); else { chunks.push(Buffer.from(chunk)); done(); }
  }});
  let result;
  try { result = await requestInto(input, sink); }
  catch { throw new CliError(Exit.network, 'Ownership check failed or was cancelled; no write sent, no retry'); }
  if (result.status !== 200) throw new CliError(httpExit(result.status) || Exit.api, `Ownership check returned HTTP ${result.status}; no write sent`);
  try { const body = parseJson(Buffer.concat(chunks).toString('utf8')); if (!object(body)) throw new Error(); return body; }
  catch { throw new CliError(Exit.api, 'Invalid ownership response; no write sent'); }
}
function rows(body: Record<string, unknown>, allowEmpty = false): Record<string, unknown>[] {
  if (!Array.isArray(body.items) || (!allowEmpty && !body.items.length) || body.items.length > 100 || !body.items.every(object) ||
      body.hasMore === true || (body.hasMore !== undefined && body.hasMore !== false) || body.count !== body.items.length ||
      body.totalResults !== body.items.length || (body.offset !== undefined && body.offset !== 0)) throw new CliError(Exit.api, 'Ownership response is empty, ambiguous or incomplete; no write sent');
  return body.items;
}
function changes(before: Record<string, unknown>, after: Record<string, unknown>): unknown[] {
  const result: unknown[] = [];
  for (const key of Object.keys(after)) if (!Object.hasOwn(before, key) || digest(before[key]) !== digest(after[key])) result.push({field: key, ...(Object.hasOwn(before, key) ? {before: before[key]} : {previouslyAbsent: true}), proposed: after[key]});
  return result;
}
// Definitions are internal, hardcoded by task modules; never user-supplied routes/schemas.
export async function executeGuardedWrite(definition: GuardedWriteDefinition, store: StateStore, options: GuardedWriteOptions,
  wait: (signal: AbortSignal) => Promise<void> = signal => delay(1100, undefined, {signal})): Promise<number> {
  const scopes = new WriteScopeStore(store.directory, definition.namespace), scope = await scopes.load();
  const initial = activeState(await store.loadCompanies());
  if (digest(writeIdentity(initial)) !== digest({company: scope.company, apiUrl: scope.apiUrl, authDigest: scope.authDigest})) throw new CliError(Exit.state, 'Selected company/account/environment differs from the write boundary');
  const body = await inputBody(options); // Read once, before auth/data activity.
  if (definition.action === 'delete' && options.json === undefined && options.file === undefined) {
    body.hierUnitId = options.hierUnitId; body.objectNum = options.objectNum;
  }
  const unverifiedFields = definition.validate(body, options, scope), wireBody = JSON.stringify(body);
  const plan = {action: definition.action, method: 'POST', url: scope.apiUrl + definition.path,
    headers: {'Content-Type': 'application/json', 'Simphony-AuditTrailRef': options.auditRef},
    company: scope.company, locationNumber: scope.locationNumber, locationHierarchyUnitId: scope.locationHierarchyUnitId,
    ...(definition.scope === 'rvc' ? {rvcHierarchyUnitId: options.hierUnitId} : {}),
    objectNum: options.objectNum, body, unverifiedFields, risks: definition.risks};
  if (!options.prepare && !options.execute) { localResult(`${definition.command} dry-run`, {...plan, authorizationOmitted: true, ownershipVerified: false, networkRequests: 0}); return Exit.ok; }
  let dispatched = false;
  try { return await withFileLock(scopes.lock, async () => {
    const approval = options.execute ? await scopes.approval() : undefined;
    function checkApproval() {
      if (approval && (approval.status !== 'prepared' || approval.id !== options.approve || approval.expiresAt <= Date.now())) throw new CliError(Exit.usage, 'Approval is expired, consumed or does not match; no write sent');
    }
    checkApproval();
    if (digest(await scopes.load()) !== digest(scope)) throw new CliError(Exit.state, 'Write boundary changed; prepare again');
    await refreshCompanies(store, true, options.timeout, options.quiet);
    return withFileLock(`${store.file}.lock`, async () => {
      const currentState = activeState(await store.loadCompanies());
      if (digest(writeIdentity(currentState)) !== digest(writeIdentity(initial))) throw new CliError(Exit.state, 'Selected company/account/environment changed; no write sent');
      const token = bearerToken(currentState), controller = new AbortController();
      const cancel = () => controller.abort(); process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
      const signal = controller.signal;
      const read = (route: string, requestBody: unknown) => proof({method: 'POST', url: scope.apiUrl + route, body: JSON.stringify(requestBody),
        headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`}, timeoutMs: (options.timeout ?? 30) * 1000, signal});
      try {
        const location = rows(await read('/config/sim/v2/hierarchy/getHierarchyNodes', {searchCriteria: `where equals(hierUnitId,${scope.locationHierarchyUnitId})`, include: 'hierUnitId,objectNum,nodeType', limit: 100, offset: 0}));
        if (!location.every(row => row.hierUnitId === scope.locationHierarchyUnitId && row.objectNum === scope.locationNumber && row.nodeType === 'Location')) throw new CliError(Exit.api, 'Location identity differs from the write boundary; no write sent');
        if (definition.scope === 'rvc') {
          await wait(signal);
          const rvcs = rows(await read('/config/sim/v2/hierarchy/getHierarchyNodes', {searchCriteria: `where equals(hierUnitId,${options.hierUnitId})`, include: 'hierUnitId,nodeType,parentHierUnitId', limit: 100, offset: 0}));
          if (!rvcs.every(row => row.hierUnitId === options.hierUnitId && row.nodeType === 'RVC' && row.parentHierUnitId === scope.locationHierarchyUnitId)) throw new CliError(Exit.api, 'RVC ownership differs from the write boundary; no write sent');
        }
        await wait(signal);
        const records = rows(await read(definition.readPath, {searchCriteria: `where (equals(hierUnitId,${options.hierUnitId}) and equals(objectNum,${options.objectNum}))`, includeAll: 'detailed', limit: 2, offset: 0}), definition.action === 'create');
        if (definition.action === 'create') {
          if (records.length !== 0) throw new CliError(Exit.api, 'Create requires confirmed absence; target already exists. No fallback to update.');
        } else if (records.length !== 1 || records[0]!.hierUnitId !== options.hierUnitId || records[0]!.objectNum !== options.objectNum) {
          throw new CliError(Exit.api, 'Target is missing, inherited, ambiguous or foreign; no write sent');
        }
        const current = records[0] ?? null, requestHash = digest({scope, plan, current});
        signal.throwIfAborted();
        if (options.prepare) {
          const fresh: WriteApproval = {schemaVersion: 1, product: scopes.approvalProduct, id: randomBytes(32).toString('hex'), requestHash, expiresAt: Date.now() + 15 * 60 * 1000, status: 'prepared'};
          await scopes.persist(scopes.approvalFile, fresh);
          localResult(`${definition.command} prepare`, {...plan, ownershipVerified: true,
            ...(definition.action === 'delete' ? {deleteTarget: {hierUnitId: options.hierUnitId, objectNum: options.objectNum, name: current?.name}, destructive: true} : {
              changes: changes(current ?? {}, body), absentFromSubmittedPayload: Object.keys(current ?? {}).filter(key => !Object.hasOwn(body, key))}),
            approval: fresh.id, expiresAt: new Date(fresh.expiresAt).toISOString(), updateSent: false, writeSent: false,
            warning: 'Review the FULL action/payload, omitted fields and risks. Approval metadata contains no record values; this is not a before-snapshot.'});
          return Exit.ok;
        }
        if (!approval || requestHash !== approval.requestHash) throw new CliError(Exit.usage, 'Action, target, payload, audit reference, boundary or current record changed since preparation; prepare and approve again');
        await wait(signal); checkApproval(); signal.throwIfAborted();
        await scopes.persist(scopes.approvalFile, {...approval, status: 'consumed'});
        signal.throwIfAborted(); dispatched = true;
        const code = await deliverResponse({method: 'POST', url: plan.url, headers: {...plan.headers, Accept: 'application/json', Authorization: `Bearer ${token}`},
          body: wireBody, timeoutMs: (options.timeout ?? 30) * 1000, signal}, definition.command, store.directory, options.quiet, undefined, 'write');
        process.stderr.write(`[cc ${definition.command}] One ${definition.action} request sent; no readback performed. Approval consumed. HTTP success is not verified application. Do not blindly retry an uncertain outcome.\n`);
        return code;
      } catch (error) {
        if (error instanceof CliError) throw error;
        throw new CliError(Exit.network, 'Write preparation/checks failed or were cancelled; no write sent');
      } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    });
  }); } catch (error) {
    if (dispatched) throw new CliError(error instanceof CliError ? error.exitCode : Exit.state,
      `${definition.command} outcome may be uncertain. Do not blindly retry; approval has been consumed.`,
      'Inspect the delivered response and any local lock/storage failure; no automatic readback or rollback was attempted.');
    throw error;
  }
}
