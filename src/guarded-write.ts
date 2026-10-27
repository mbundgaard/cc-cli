import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { StateStore, activeState, bearerToken } from './state.js';
import { refreshCompanies } from './companies.js';
import { inputBody, type QueryOptions } from './requests.js';
import { httpExit, type HttpRequest } from './transport.js';
import { issueConfigurationWritePermit, requireConfigurationOperation, readOperationById, mutationOperationById } from './configuration-policy.js';
import { verifyCapture, type CaptureReference } from './captures.js';
import { exchangeConfiguration, publishConfiguration } from './configuration-exchange.js';
import { prepareMutationAttempt } from './mutation-journal.js';
import { CliError, Exit, localResult } from './output.js';
import { parseJson, isRawJson } from './json.js';
import { WriteScopeStore, withFileLock, writeIdentity, digest, positiveId, type WriteScope, type WriteApproval } from './write-scope.js';

export const writeRisks = [
  'Omitted optional fields may be cleared; this is not PATCH or an automatic read/merge/write.',
  'Documentation and observed reads do not prove completeness or writability. Explicit null may clear or be rejected.',
  'Ownership/existence and approval freshness checks are not atomic with the write. No documented conditional-write guarantee.',
  'One top-level record only; nested settings may affect child rows. Mandatory pre-change capture is evidence, not restore capability. No automatic readback, retry, or rollback.',
];
export interface GuardedWriteOptions extends QueryOptions {
  hierUnitId: number; objectNum: number; prepare?: boolean; execute?: boolean;
  approve?: string; ackUpdateRisks?: boolean; allowUnverifiedFields?: boolean; confirmDelete?: number;
}
export interface GuardedWriteDefinition {
  command: string; action: 'create' | 'update' | 'delete'; path: string; readPath: string;
  scope: 'location' | 'rvc'; namespace: 'order-device' | 'kds-display'; risks: readonly string[];
  validate: (body: Record<string, unknown>, options: GuardedWriteOptions, scope: WriteScope) => string[];
}
export function guardedDefinition(operationId: string, command: string, risks: readonly string[], validate: GuardedWriteDefinition['validate']): GuardedWriteDefinition {
  const operation = mutationOperationById(operationId), read = readOperationById(operation.readOperationId);
  return {command, action: operation.effect, path: operation.path, readPath: read.path,
    scope: operation.scope, namespace: operation.namespace, risks, validate};
}
export const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && !isRawJson(value); }
export function auditReference(username: unknown): string {
  if (typeof username !== 'string' || !username.trim() || /[\u0000-\u001f\u007f-\uffff]/.test(username)) throw new CliError(Exit.usage, 'The saved username must be nonblank printable ASCII for the audit reference; no write sent');
  const reference = `Muneris CC-CLI // ${username}`;
  if (reference.length > 50) throw new CliError(Exit.usage, 'Muneris CC-CLI // <saved username> exceeds the 50-character audit-reference limit; username was not truncated and no write sent');
  return reference;
}
export function validateWriteControls(body: Record<string, unknown>, options: GuardedWriteOptions): void {
  positiveId(options.hierUnitId, '--hier-unit-id'); positiveId(options.objectNum, '--object-num');
  if (body.hierUnitId !== options.hierUnitId || body.objectNum !== options.objectNum) throw new CliError(Exit.usage, 'Payload hierUnitId/objectNum must exactly match the explicit target flags');
  if (Object.hasOwn(options, 'auditRef')) throw new CliError(Exit.usage, 'Custom audit references are not supported; the CLI uses Muneris CC-CLI // <saved username>');
  if (!Number.isFinite(options.timeout ?? 30) || (options.timeout ?? 30) <= 0 || (options.timeout ?? 30) > 300) throw new CliError(Exit.usage, 'Timeout must be positive and at most 300 seconds');
  if ([options.dryRun, options.prepare, options.execute].filter(Boolean).length > 1) throw new CliError(Exit.usage, 'Choose only one of --dry-run, --prepare, --execute');
  if ((options.approve || options.ackUpdateRisks) && !options.execute) throw new CliError(Exit.usage, '--approve and --ack-update-risks require --execute');
  if (options.execute && (!options.ackUpdateRisks || !/^[a-f0-9]{64}$/.test(options.approve ?? ''))) throw new CliError(Exit.usage, '--execute requires --approve <one-use-id> and --ack-update-risks');
  if (Buffer.byteLength(JSON.stringify(body)) > 1024 * 1024) throw new CliError(Exit.usage, 'Write body exceeds the 1 MiB limit');
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
  const auditRef = auditReference(initial.auth.username);
  const body = await inputBody(options); // Read once, before auth/data activity.
  if (definition.action === 'delete' && options.json === undefined && options.file === undefined) {
    body.hierUnitId = options.hierUnitId; body.objectNum = options.objectNum;
  }
  const unverifiedFields = definition.validate(body, options, scope), wireBody = JSON.stringify(body);
  const plan = {action: definition.action, method: 'POST', url: scope.apiUrl + definition.path,
    headers: {'Content-Type': 'application/json', 'Simphony-AuditTrailRef': auditRef},
    company: scope.company, locationNumber: scope.locationNumber, locationHierarchyUnitId: scope.locationHierarchyUnitId,
    ...(definition.scope === 'rvc' ? {rvcHierarchyUnitId: options.hierUnitId} : {}),
    objectNum: options.objectNum, body, unverifiedFields, risks: definition.risks};
  const capability = mutationOperationById(requireConfigurationOperation({method: plan.method, url: plan.url}, definition.action).id);
  const targetRead = readOperationById(capability.readOperationId);
  if (definition.readPath !== targetRead.path || definition.namespace !== capability.namespace || definition.scope !== capability.scope) {
    throw new CliError(Exit.usage, 'Mutation definition does not match reviewed capability metadata');
  }
  if (!options.prepare && !options.execute) { localResult(`${definition.command} dry-run`, {...plan, authorizationOmitted: true, ownershipVerified: false, networkRequests: 0}); return Exit.ok; }
  let dispatched = false;
  try { return await withFileLock(scopes.lock, async () => {
    const approval = options.execute ? await scopes.approval() : undefined;
    function checkApproval() {
      if (approval && (approval.status !== 'prepared' || approval.id !== options.approve || approval.expiresAt <= Date.now())) throw new CliError(Exit.usage, 'Approval is expired, consumed or does not match; no write sent');
    }
    checkApproval();
    if (approval) await verifyCapture(store.directory, approval.beforeCapture!);
    if (digest(await scopes.load()) !== digest(scope)) throw new CliError(Exit.state, 'Write boundary changed; prepare again');
    await refreshCompanies(store, true, options.timeout, options.quiet);
    return withFileLock(`${store.file}.lock`, async () => {
      const currentState = activeState(await store.loadCompanies());
      if (digest(writeIdentity(currentState)) !== digest(writeIdentity(initial))) throw new CliError(Exit.state, 'Selected company/account/environment changed; no write sent');
      const token = bearerToken(currentState), controller = new AbortController();
      const cancel = () => controller.abort(); process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
      const signal = controller.signal;
      let beforeCapture: CaptureReference | undefined;
      const read = async (route: string, requestBody: Record<string, unknown>, target = false) => {
        const input: HttpRequest = {method: 'POST', url: scope.apiUrl + route, body: JSON.stringify(requestBody),
          headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`}, timeoutMs: (options.timeout ?? 30) * 1000, signal};
        const capability = readOperationById(requireConfigurationOperation(input, 'read').id);
        const result = await exchangeConfiguration(input, store.directory, {kind: 'read',
          capture: {company: scope.company, apiUrl: scope.apiUrl, task: capability.task, apiVersion: capability.apiVersion,
            scopeKind: target ? definition.scope === 'rvc' ? 'rvc' : 'location' : 'organization', scopeId: target ? String(options.hierUnitId) : 'all',
            detail: target ? 'detailed' : 'projection', ...(target ? {} : {projection: requestBody.include as string}),
            purpose: target ? definition.action === 'create' ? 'pre-create' : definition.action === 'delete' ? 'pre-delete' : 'pre-update' : 'ownership',
            ...(target ? {expectedObjectNum: String(options.objectNum), requireRecord: definition.action !== 'create'} : {})},
          ...(target ? {proposed: body} : {})});
        if (result.status !== 200) throw new CliError(httpExit(result.status) || Exit.api, `Ownership check returned HTTP ${result.status}; no write sent`);
        if (result.delivery.bytes > 1024 * 1024) throw new CliError(Exit.api, 'Ownership response too large; no write sent');
        if (target) {
          if (!result.captured) throw new CliError(Exit.state, 'Missing mandatory target capture');
          const saved = result.captured;
          beforeCapture = {captureId: saved.captureId, manifestPath: saved.manifestPath, manifestSha256: saved.manifestSha256};
          await verifyCapture(store.directory, beforeCapture);
        }
        const parsed = parseJson(await readFile(result.delivery.path, 'utf8'));
        if (!object(parsed)) throw new CliError(Exit.api, 'Invalid ownership record envelope');
        return parsed;
      };
      try {
        const location = rows(await read('/config/sim/v2/hierarchy/getHierarchyNodes', {searchCriteria: `where equals(hierUnitId,${scope.locationHierarchyUnitId})`, include: 'hierUnitId,hierStrucId,objectNum,nodeType', limit: 100, offset: 0}));
        if (!location.every(row => row.hierUnitId === scope.locationHierarchyUnitId && row.objectNum === scope.locationNumber && row.nodeType === 'Location')) throw new CliError(Exit.api, 'Location identity differs from the write boundary; no write sent');
        if (definition.scope === 'rvc') {
          await wait(signal);
          const rvcs = rows(await read('/config/sim/v2/hierarchy/getHierarchyNodes', {searchCriteria: `where equals(hierUnitId,${options.hierUnitId})`, include: 'hierUnitId,hierStrucId,nodeType,parentHierUnitId', limit: 100, offset: 0}));
          if (!rvcs.every(row => row.hierUnitId === options.hierUnitId && row.nodeType === 'RVC' && row.parentHierUnitId === scope.locationHierarchyUnitId)) throw new CliError(Exit.api, 'RVC ownership differs from the write boundary; no write sent');
        }
        await wait(signal);
        const records = rows(await read(definition.readPath, {searchCriteria: `where (equals(hierUnitId,${options.hierUnitId}) and equals(objectNum,${options.objectNum}))`, includeAll: 'detailed', limit: 2, offset: 0}, true), definition.action === 'create');
        if (definition.action === 'create') {
          if (records.length !== 0) throw new CliError(Exit.api, 'Create requires confirmed absence; target already exists. No fallback to update.');
        } else if (records.length !== 1 || records[0]!.hierUnitId !== options.hierUnitId || records[0]!.objectNum !== options.objectNum) {
          throw new CliError(Exit.api, 'Target is missing, inherited, ambiguous or foreign; no write sent');
        }
        if (!beforeCapture) throw new CliError(Exit.state, 'Required pre-change capture is missing; no write sent');
        const current = records[0] ?? null, requestHash = digest({scope, plan, current,
          beforeCapture: options.prepare ? beforeCapture : approval?.beforeCapture});
        signal.throwIfAborted();
        if (options.prepare) {
          const fresh: WriteApproval = {schemaVersion: 1, product: scopes.approvalProduct, id: randomBytes(32).toString('hex'), requestHash, expiresAt: Date.now() + 15 * 60 * 1000, status: 'prepared', beforeCapture};
          await scopes.persist(scopes.approvalFile, fresh);
          localResult(`${definition.command} prepare`, {...plan, ownershipVerified: true,
            ...(definition.action === 'delete' ? {deleteTarget: {hierUnitId: options.hierUnitId, objectNum: options.objectNum, name: current?.name}, destructive: true} : {
              changes: changes(current ?? {}, body), absentFromSubmittedPayload: Object.keys(current ?? {}).filter(key => !Object.hasOwn(body, key))}),
            beforeCapture, approval: fresh.id, expiresAt: new Date(fresh.expiresAt).toISOString(), updateSent: false, writeSent: false,
            warning: 'Review the FULL action/payload, omitted fields and risks. Saved pre-change evidence is linked by beforeCapture; it is not a restorable write payload.'});
          return Exit.ok;
        }
        if (!approval || requestHash !== approval.requestHash) throw new CliError(Exit.usage, 'Action, target, payload, audit reference, boundary or current record changed since preparation; prepare and approve again');
        await wait(signal); checkApproval(); signal.throwIfAborted();
        await verifyCapture(store.directory, beforeCapture);
        const request: HttpRequest = {method: 'POST', url: plan.url, headers: {...plan.headers, Accept: 'application/json', Authorization: `Bearer ${token}`},
          body: wireBody, timeoutMs: (options.timeout ?? 30) * 1000, signal};
        const attempt = await prepareMutationAttempt(store.directory, request, definition.action, scope.company, approval.id, approval.beforeCapture!, beforeCapture);
        await scopes.persist(scopes.approvalFile, {...approval, status: 'consumed', executionCapture: beforeCapture, attemptPath: attempt.path});
        signal.throwIfAborted();
        const permit = issueConfigurationWritePermit(request, definition.action);
        dispatched = true;
        const result = await exchangeConfiguration(request, store.directory, {kind: 'write', permit, attempt});
        const code = await publishConfiguration(result, definition.command, options.quiet);
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
